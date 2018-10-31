'use strict';

/* eslint camelcase: "off" */
/* eslint max-len: "off" */

const assert = require('bsert');
const BigMath = require('./bigmath');
const util = require('./util');
const defs = require('./defs');
const {bitLength} = BigMath;

class CombPrecomp {
  constructor(g, combspec, gops) {
    this.gops = null;
    this.points_per_add = 0;
    this.adds_per_shift = 0;
    this.nshifts = 0;
    this.bits_per_window = 0;
    this.nbits = 0;
    this.points_per_subcomb = 0;
    this.items = [];
    this.init(g, combspec, gops);
  }

  init(g, combspec, gops) {
    assert(Array.isArray(combspec));
    assert(combspec.length === 6);
    assert(gops && typeof gops.mul === 'function');
    assert(gops.is_element(g));

    const [ppa, aps, nshifts, bpw, , size] = combspec;

    assert((ppa >>> 0) === ppa);
    assert((aps >>> 0) === aps);
    assert((nshifts >>> 0) === nshifts);
    assert((bpw >>> 0) === bpw);
    assert((size >>> 0) === size);

    this.gops = gops;
    this.points_per_add = ppa;
    this.adds_per_shift = aps;
    this.nshifts = nshifts;
    this.bits_per_window = bpw;
    this.nbits = bpw * ppa;

    const nskip = 2 ** ppa - 1;

    this.points_per_subcomb = nskip;

    // allocate space
    this.items = [];

    for (let i = 0; i < size; i++)
      this.items.push(gops.element());

    // compute bottom comb
    this.items[0] = g;

    const window = 1n << BigInt(bpw);

    for (let i = 1; i < ppa; i++) {
      const oval = 2 ** i;
      const ival = oval >>> 1;

      this.items[oval - 1] = gops.pow(this.items[ival - 1], null, window);

      for (let j = oval + 1; j < 2 * oval; j++)
        this.items[j - 1] = gops.mul(this.items[j - oval - 1], this.items[oval - 1]);
    }

    const powval = 1n << BigInt(nshifts);

    for (let i = 1; i < aps; i++) {
      for (let j = 0; j < nskip; j++) {
        const k = i * nskip + j;
        const n = this.items[k - nskip];

        this.items[k] = gops.pow(n, null, powval);
      }
    }

    this.ebits = new Uint8Array(this.nbits);
    this.wins = [];

    for (let i = 0; i < this.nshifts; i++)
      this.wins.push(new Int32Array(this.adds_per_shift));
  }

  to_comb_exp(e) {
    assert(typeof e === 'bigint');

    let i = 0;
    let len = bitLength(e);

    if (len === 0)
      len = 1;

    assert(this.nbits >= len);

    let pre = this.nbits - len;

    while (pre--)
      this.ebits[i++] = 0;

    let pos = BigInt(len);

    while (pos--) {
      if ((e >> pos) & 1n)
        this.ebits[i++] = 1;
      else
        this.ebits[i++] = 0;
    }

    for (let i = this.adds_per_shift - 1; i >= 0; i--) {
      for (let j = 0; j < this.nshifts; j++) {
        let ret = 0;
        for (let k = 0; k < this.points_per_add; k++) {
          const b = (i + k * this.adds_per_shift) * this.nshifts + j;
          ret *= 2;
          // ret += Number((e >> BigInt((this.nbits - 1) - b)) & 1n);
          ret += this.ebits[b];
        }
        this.wins[j][(this.adds_per_shift - 1) - i] = ret;
      }
    }

    return this.wins;
  }

  to_json() {
    return {
      points_per_add: this.points_per_add,
      adds_per_shift: this.adds_per_shift,
      nshifts: this.nshifts,
      bits_per_window: this.bits_per_window,
      nbits: this.nbits,
      points_per_subcomb: this.points_per_subcomb,
      size: this.items.length,
      items: this.items.map(item => BigMath.encodeHex(item))
    };
  }

  static gen_opt_combs(nbits, maxsize = null) {
    assert((nbits >>> 0) === nbits);
    assert(maxsize == null || (maxsize >>> 0) === maxsize);

    // an "optimal" comb for a given #ops is the one that uses the least storage
    //                   for a given storage size is the one that uses the least ops

    const opt_combs = new Map();

    const _gen_comb_result = (nshifts, adds_per_shift, points_per_add, bits_per_window) => {
      // NOTE: this assumes add/mull and double/square have the same cost;
      //       you might adjust this to get a better optimzation result!
      const nops = nshifts * (adds_per_shift + 1) - 1;
      const size = (2 ** points_per_add - 1) * adds_per_shift;
      const result = [points_per_add, adds_per_shift, nshifts, bits_per_window, nops, size];
      const best_so_far = opt_combs.get(nops) || null;

      if (best_so_far == null || best_so_far[5] > size)
        opt_combs.set(nops, result);
    };

    for (let points_per_add = 2; points_per_add < 18; points_per_add++) {
      const bits_per_window = ((nbits + points_per_add - 1) / points_per_add) >>> 0;
      const sqrt_bpw = util.dsqrt(bits_per_window);

      for (let adds_per_shift = 1; adds_per_shift < sqrt_bpw + 2; adds_per_shift++) {
        if (bits_per_window % adds_per_shift !== 0) {
          // only factorizations of bits_per_window are useful
          continue;
        }

        const nshifts = (bits_per_window / adds_per_shift) >>> 0;

        _gen_comb_result(nshifts, adds_per_shift, points_per_add, bits_per_window);
        _gen_comb_result(adds_per_shift, nshifts, points_per_add, bits_per_window);
      }
    }

    const ret_all = [];

    let ret = null;
    let sm = null;

    const keys = util.list(opt_combs.keys()).sort((a, b) => a - b);

    for (const nops of keys) {
      const opt_comb_val = opt_combs.get(nops);

      if (sm != null && sm <= opt_comb_val[5])
        continue;

      sm = opt_comb_val[5];
      ret_all.push(opt_comb_val);

      if (ret == null && maxsize != null && opt_comb_val[5] <= maxsize) {
        ret = opt_comb_val;
        break;
      }
    }

    if (maxsize == null)
      return ret_all;

    return ret;
  }
}

class CombMixin {
  constructor() {
    this.combs = [];
  }

  init_comb(max_comb_size, modbits) {
    assert((max_comb_size >>> 0) === max_comb_size);
    assert(modbits == null || (modbits >>> 0) === modbits);

    // combs for g and h
    // NOTE: you really want to store all combs on disk!
    //     I'd recommend having a telescope of combs supporting up to (say)
    //     8192-bit RSA keys (i.e., a ~(2 * 8192 + chalbits + 1) sized comb)
    //     sized for the group of unknown order (see big_prod_size below)
    //
    // P needs two comb sizes, V needs one
    //
    // figure out comb sizes

    if (modbits != null) {
      // largest exponent P handles is the greater of
      //     chalbits + 2 * log2(P's RSA modulus) + 1
      //     chalbits + log2(P's RSA modulus) + log2(n) + 1
      const big_nbits = Math.max(2 * modbits, modbits + this.nbits_rand) + defs.chalbits + 1;
      const big_combspec = CombPrecomp.gen_opt_combs(big_nbits, max_comb_size);
      const small_nbits = this.nbits_rand;
      const small_combspec = CombPrecomp.gen_opt_combs(small_nbits, max_comb_size);

      this.combs = [
        [
          new CombPrecomp(this.g, small_combspec, this),
          new CombPrecomp(this.h, small_combspec, this)
        ],
        [
          new CombPrecomp(this.g, big_combspec, this),
          new CombPrecomp(this.h, big_combspec, this)
        ]
      ];
    } else {
      const tiny_nbits = defs.chalbits;
      const tiny_combspec = CombPrecomp.gen_opt_combs(tiny_nbits, max_comb_size);
      this.combs = [
        [
          new CombPrecomp(this.g, tiny_combspec, this),
          new CombPrecomp(this.h, tiny_combspec, this)
        ]
      ];
    }
  }

  powgh(e1, e2) {
    assert(typeof e1 === 'bigint');
    assert(typeof e2 === 'bigint');

    const loge = Math.max(bitLength(e1), bitLength(e2));

    let gcomb = null;
    let hcomb = null;

    for (const c of this.combs) {
      if (loge <= c[0].nbits) {
        [gcomb, hcomb] = c;
        break;
      }
    }

    if (!gcomb || !hcomb)
      throw new Error('got unexpectedly large exponent in powgh');

    let ret = this.id;

    const e1e = gcomb.to_comb_exp(e1);
    const e2e = hcomb.to_comb_exp(e2);

    for (let i = 0; i < e1e.length; i++) {
      const e1vs = e1e[i];
      const e2vs = e2e[i];

      if (!this.equals(ret, this.id))
        ret = this.sqr(ret);

      for (let j = 0; j < e1vs.length; j++) {
        const e1v = e1vs[j];
        const e2v = e2vs[j];

        if (e1v !== 0) {
          const g = gcomb.items[j * gcomb.points_per_subcomb + e1v - 1];
          ret = this.mul(ret, g);
        }

        if (e2v !== 0) {
          const h = hcomb.items[j * hcomb.points_per_subcomb + e2v - 1];
          ret = this.mul(ret, h);
        }
      }
    }

    return ret;
  }
}

class WnafMixin extends CombMixin {
  constructor() {
    super();
    this._one_mul = this._one_mul_expinv;
    this._precomp_wnaf = this._precomp_wnaf_expinv;
    this.e1bits = new Int32Array(defs.rand_exponent_size * 2 + 2);
    this.e2bits = new Int32Array(defs.rand_exponent_size * 2 + 2);
  }

  init_wnaf(cheap_inv = false) {
    assert(typeof cheap_inv === 'boolean');

    if (cheap_inv) {
      this._one_mul = this._one_mul_cheapinv;
      this._precomp_wnaf = this._precomp_wnaf_cheapinv;
    }
  }

  _wnaf_pc_help(b, winsize) {
    assert(this.is_element(b));
    assert((winsize >>> 0) === winsize);
    assert(winsize >= 2);

    const tablen = 2 ** (winsize - 2);
    const pctab = new Array(tablen);
    const bSq = this.sqr(b);

    pctab[0] = b;

    for (let i = 1; i < tablen; i++)
      pctab[i] = this.mul(pctab[i - 1], bSq);

    return pctab;
  }

  _one_mul_cheapinv(ret, w, pctabP, _) {
    assert(this.is_element(ret));
    assert(typeof w === 'number');
    assert(Array.isArray(pctabP));

    if (w > 0)
      ret = this.mul(ret, pctabP[(w - 1) >>> 1]);
    else if (w < 0)
      ret = this.mul(ret, this.inv(pctabP[(-1 - w) >>> 1]));

    return ret;
  }

  _one_mul_expinv(ret, w, pctabP, pctabN) {
    assert(this.is_element(ret));
    assert(typeof w === 'number');
    assert(Array.isArray(pctabP));
    assert(Array.isArray(pctabN));

    if (w > 0)
      ret = this.mul(ret, pctabP[(w - 1) >>> 1]);
    else if (w < 0)
      ret = this.mul(ret, pctabN[(-1 - w) >>> 1]);

    return ret;
  }

  _precomp_wnaf_cheapinv(b, _, winsize) {
    return [this._wnaf_pc_help(b, winsize), null];
  }

  _precomp_wnaf_expinv(b, bInv, winsize) {
    return [this._wnaf_pc_help(b, winsize), this._wnaf_pc_help(bInv, winsize)];
  }

  _wnaf(r, ws, out, bitlen) {
    assert(typeof r === 'bigint');
    assert(typeof ws === 'number');
    assert(out instanceof Int32Array);
    assert((bitlen >>> 0) === bitlen);
    assert(bitlen <= out.length);

    const w = BigInt(ws);

    for (let i = bitlen - 1; i >= 0; i--) {
      let val = 0n;

      if (r % 2n) {
        val = r & ((1n << w) - 1n);
        if (val & (1n << (w - 1n)))
          val -= 1n << w;
        r -= val;
      }

      out[i] = Number(val);

      r = r >> 1n;
    }

    assert(r === 0n);

    return out;
  }

  pow(b, bInv, e) {
    assert(this.is_element(b));

    const [pctabP, pctabN] = this._precomp_wnaf(b, bInv, defs.winsize);
    const totlen = bitLength(e) + 1;
    const ebits = this._wnaf(e, defs.winsize, this.e1bits, totlen);

    let ret = this.id;

    for (let i = 0; i < totlen; i++) {
      const w = ebits[i];

      if (!this.equals(ret, this.id))
        ret = this.sqr(ret);

      ret = this._one_mul(ret, w, pctabP, pctabN);
    }

    return ret;
  }

  pow2(b1, b1Inv, e1, b2, b2Inv, e2) {
    assert(this.is_element(b1));
    assert(this.is_element(b2));

    const [pctabP1, pctabN1] = this._precomp_wnaf(b1, b1Inv, defs.winsize);
    const [pctabP2, pctabN2] = this._precomp_wnaf(b2, b2Inv, defs.winsize);

    const totlen = Math.max(bitLength(e1), bitLength(e2)) + 1;
    const e1bits = this._wnaf(e1, defs.winsize, this.e1bits, totlen);
    const e2bits = this._wnaf(e2, defs.winsize, this.e2bits, totlen);

    let ret = this.id;

    for (let i = 0; i < totlen; i++) {
      const w1 = e1bits[i];
      const w2 = e2bits[i];

      if (!this.equals(ret, this.id))
        ret = this.sqr(ret);

      ret = this._one_mul(ret, w1, pctabP1, pctabN1);
      ret = this._one_mul(ret, w2, pctabP2, pctabN2);
    }

    return ret;
  }
}

class RandMixin extends WnafMixin {
  constructor() {
    super();
    this.nbits_rand = 0;
    this.prng = null;
  }

  init_rand(nbits, prng) {
    if (prng == null)
      prng = util.rand;

    assert((nbits >>> 0) === nbits);

    this.nbits_rand = nbits;
    this.prng = prng;
  }

  rand_scalar() {
    const size = Math.min(defs.rand_exponent_size, this.nbits_rand);
    return this.prng.getrandbits(size);
  }
}

exports.CombPrecomp = CombPrecomp;
exports.CombMixin = CombMixin;
exports.WnafMixin = WnafMixin;
exports.RandMixin = RandMixin;