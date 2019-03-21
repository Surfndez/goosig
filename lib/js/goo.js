/*!
 * goo.js - groups of unknown order for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/handshake-org/goosig
 *
 * Parts of this software are based on kwantam/libGooPy:
 *   Copyright (c) 2018, Dan Boneh, Riad S. Wahby (Apache License).
 *   https://github.com/kwantam/GooSig
 *
 * Resources:
 *   https://github.com/kwantam/GooSig/blob/master/protocol.txt
 *   https://github.com/kwantam/GooSig/blob/master/libGooPy/group_ops.py
 *   https://github.com/kwantam/GooSig/blob/master/libGooPy/group_mixins.py
 *   https://github.com/kwantam/GooSig/blob/master/libGooPy/tokengen.py
 *   https://github.com/kwantam/GooSig/blob/master/libGooPy/sign.py
 *   https://github.com/kwantam/GooSig/blob/master/libGooPy/verify.py
 */

/* eslint camelcase: "off" */
/* eslint valid-typeof: "off" */

'use strict';

const assert = require('bsert');
const SHA256 = require('bcrypto/lib/sha256');
const BigMath = require('./bigmath');
const constants = require('../internal/constants');
const primes = require('./primes');
const PRNG = require('./prng');
const rsa = require('../internal/rsa');
const Signature = require('./signature');
const util = require('./util');

/*
 * Goo
 */

class Goo {
  constructor(n, g, h, modBits) {
    if (modBits == null)
      modBits = 0;

    assert(Buffer.isBuffer(n));
    assert((g >>> 0) === g);
    assert((h >>> 0) === h);
    assert((modBits >>> 0) === modBits);

    this.n = BigMath.decode(n);
    this.bits = BigMath.bitLength(this.n);
    this.size = (this.bits + 7) >>> 3;
    this.nh = this.n >> 1n;
    this.g = BigInt(g);
    this.h = BigInt(h);
    this.nRaw = BigMath.encode(this.n);
    this.gRaw = BigMath.encode(this.g, 4);
    this.hRaw = BigMath.encode(this.h, 4);
    this.randBits = util.clog2(this.n) - 1;
    this.e1bits = new Int32Array(constants.CHAL_BITS + 1);
    this.e2bits = new Int32Array(constants.CHAL_BITS + 1);
    this.combs = [];

    this.init(constants.MAX_COMB_SIZE, modBits);
  }

  init(maxCombSize, modBits) {
    assert((maxCombSize >>> 0) === maxCombSize);
    assert((modBits >>> 0) === modBits);

    if (modBits !== 0) {
      if (modBits < constants.MIN_RSA_BITS
          || modBits > constants.MAX_RSA_BITS) {
        throw new Error('Invalid modulus bits.');
      }

      const big = Math.max(2 * modBits, modBits + this.randBits);
      const bigBits = big + constants.CHAL_BITS + 1;
      const bigSpec = Comb.generate(bigBits, maxCombSize);
      const smallBits = this.randBits;
      const smallSpec = Comb.generate(smallBits, maxCombSize);

      this.combs = [
        {
          g: new Comb(this, this.g, smallSpec),
          h: new Comb(this, this.h, smallSpec)
        },
        {
          g: new Comb(this, this.g, bigSpec),
          h: new Comb(this, this.h, bigSpec)
        }
      ];
    } else {
      const tinyBits = constants.CHAL_BITS;
      const tinySpec = Comb.generate(tinyBits, maxCombSize);

      this.combs = [
        {
          g: new Comb(this, this.g, tinySpec),
          h: new Comb(this, this.h, tinySpec)
        }
      ];
    }
  }

  randomScalar() {
    const size = Math.min(constants.EXPONENT_SIZE, this.randBits);
    return util.randomBits(size);
  }

  wnafPCHelp(b, winSize) {
    assert(typeof b === 'bigint');
    assert((winSize >>> 0) === winSize);
    assert(winSize >= 2);

    const len = 2 ** (winSize - 2);
    const table = new Array(len);
    const sqr = this.sqr(b);

    table[0] = b;

    for (let i = 1; i < len; i++)
      table[i] = this.mul(table[i - 1], sqr);

    return table;
  }

  oneMul(ret, w, pctabP, pctabN) {
    assert(typeof ret === 'bigint');
    assert(typeof w === 'number');
    assert(Array.isArray(pctabP));
    assert(Array.isArray(pctabN));

    if (w > 0)
      ret = this.mul(ret, pctabP[(w - 1) >>> 1]);
    else if (w < 0)
      ret = this.mul(ret, pctabN[(-1 - w) >>> 1]);

    return ret;
  }

  precompWnaf(b, bInv, winsize) {
    return [
      this.wnafPCHelp(b, winsize),
      this.wnafPCHelp(bInv, winsize)
    ];
  }

  wnaf(e, ws, out, bitlen) {
    assert(typeof e === 'bigint');
    assert(typeof ws === 'number');
    assert(out instanceof Int32Array);
    assert((bitlen >>> 0) === bitlen);
    assert(bitlen <= out.length);

    const w = BigInt(ws);

    for (let i = bitlen - 1; i >= 0; i--) {
      let val = 0n;

      if (e & 1n) {
        val = e & ((1n << w) - 1n);
        if (val & (1n << (w - 1n)))
          val -= 1n << w;
        e -= val;
      }

      out[i] = Number(val);

      e >>= 1n;
    }

    assert(e === 0n);

    return out;
  }

  reduce(b) {
    assert(typeof b === 'bigint');

    if (b > this.nh)
      return this.n - b;

    return b;
  }

  isReduced(b) {
    assert(typeof b === 'bigint');

    return b <= this.nh;
  }

  sqr(b) {
    return BigMath.modPow(b, 2n, this.n);
  }

  mul(m1, m2) {
    assert(typeof m1 === 'bigint');
    assert(typeof m2 === 'bigint');

    return BigMath.mod(m1 * m2, this.n);
  }

  pow(b, bInv, e) {
    return BigMath.modPow(b, e, this.n);
  }

  powWnaf(b, bInv, e) {
    assert(typeof b === 'bigint');

    if (bInv == null)
      return this.pow(b, bInv, e);

    const ws = constants.WINDOW_SIZE;
    const [pctabP, pctabN] = this.precompWnaf(b, bInv, ws);
    const totlen = BigMath.bitLength(e) + 1;

    if (totlen > constants.CHAL_BITS + 1)
      throw new Error('Got unexpectedly large exponent in pow.');

    const ebits = this.wnaf(e, ws, this.e1bits, totlen);

    let ret = 1n;

    for (let i = 0; i < totlen; i++) {
      const w = ebits[i];

      if (ret !== 1n)
        ret = this.sqr(ret);

      ret = this.oneMul(ret, w, pctabP, pctabN);
    }

    return ret;
  }

  pow2Slow(b1, b1Inv, e1, b2, b2Inv, e2) {
    const q1 = BigMath.modPow(b1, e1, this.n);
    const q2 = BigMath.modPow(b2, e2, this.n);
    return BigMath.mod(q1 * q2, this.n);
  }

  pow2(b1, b1Inv, e1, b2, b2Inv, e2) {
    assert(typeof b1 === 'bigint');
    assert(typeof b2 === 'bigint');

    const ws = constants.WINDOW_SIZE;
    const [pctabP1, pctabN1] = this.precompWnaf(b1, b1Inv, ws);
    const [pctabP2, pctabN2] = this.precompWnaf(b2, b2Inv, ws);

    const totlen = Math.max(BigMath.bitLength(e1), BigMath.bitLength(e2)) + 1;

    if (totlen > constants.CHAL_BITS + 1)
      throw new Error('Got unexpectedly large exponent in pow2.');

    const e1bits = this.wnaf(e1, ws, this.e1bits, totlen);
    const e2bits = this.wnaf(e2, ws, this.e2bits, totlen);

    let ret = 1n;

    for (let i = 0; i < totlen; i++) {
      const w1 = e1bits[i];
      const w2 = e2bits[i];

      if (ret !== 1n)
        ret = this.sqr(ret);

      ret = this.oneMul(ret, w1, pctabP1, pctabN1);
      ret = this.oneMul(ret, w2, pctabP2, pctabN2);
    }

    return ret;
  }

  powghSlow(e1, e2) {
    const q1 = BigMath.modPow(this.g, e1, this.n);
    const q2 = BigMath.modPow(this.h, e2, this.n);
    return BigMath.mod(q1 * q2, this.n);
  }

  powgh(e1, e2) {
    assert(typeof e1 === 'bigint');
    assert(typeof e2 === 'bigint');

    const loge = Math.max(BigMath.bitLength(e1), BigMath.bitLength(e2));

    let gcomb = null;
    let hcomb = null;

    for (const item of this.combs) {
      if (loge <= item.g.bits) {
        gcomb = item.g;
        hcomb = item.h;
        break;
      }
    }

    if (!gcomb || !hcomb)
      throw new Error('Got unexpectedly large exponent in powgh.');

    const e1e = gcomb.toCombExp(e1);
    const e2e = hcomb.toCombExp(e2);

    let ret = 1n;

    for (let i = 0; i < e1e.length; i++) {
      const e1vs = e1e[i];
      const e2vs = e2e[i];

      if (ret !== 1n)
        ret = this.sqr(ret);

      for (let j = 0; j < e1vs.length; j++) {
        const e1v = e1vs[j];
        const e2v = e2vs[j];

        if (e1v !== 0) {
          const g = gcomb.items[j * gcomb.pointsPerSubcomb + e1v - 1];
          ret = this.mul(ret, g);
        }

        if (e2v !== 0) {
          const h = hcomb.items[j * hcomb.pointsPerSubcomb + e2v - 1];
          ret = this.mul(ret, h);
        }
      }
    }

    return ret;
  }

  inv(b) {
    const r = util.modInverseP(b, this.n);

    if (r == null)
      throw new Error('Could not find inverse.');

    return r;
  }

  inv2(b1, b2) {
    assert(typeof b1 === 'bigint');
    assert(typeof b2 === 'bigint');

    const b12Inv = this.inv(b1 * b2);

    return [
      BigMath.mod(b2 * b12Inv, this.n),
      BigMath.mod(b1 * b12Inv, this.n)
    ];
  }

  inv7(b1, b2, b3, b4, b5, b6, b7) {
    assert(typeof b1 === 'bigint');
    assert(typeof b2 === 'bigint');
    assert(typeof b3 === 'bigint');
    assert(typeof b4 === 'bigint');
    assert(typeof b5 === 'bigint');
    assert(typeof b6 === 'bigint');
    assert(typeof b7 === 'bigint');

    const b12 = BigMath.mod(b1 * b2, this.n);
    const b34 = BigMath.mod(b3 * b4, this.n);
    const b56 = BigMath.mod(b5 * b6, this.n);
    const b1234 = BigMath.mod(b12 * b34, this.n);
    const b123456 = BigMath.mod(b1234 * b56, this.n);
    const b1234567 = BigMath.mod(b123456 * b7, this.n);

    const b1234567Inv = this.inv(b1234567);
    const b123456Inv = BigMath.mod(b1234567Inv * b7, this.n);
    const b1234Inv = BigMath.mod(b123456Inv * b56, this.n);
    const b56Inv = BigMath.mod(b123456Inv * b1234, this.n);
    const b34Inv = BigMath.mod(b1234Inv * b12, this.n);
    const b12Inv = BigMath.mod(b1234Inv * b34, this.n);

    return [
      BigMath.mod(b12Inv * b2, this.n),
      BigMath.mod(b12Inv * b1, this.n),
      BigMath.mod(b34Inv * b4, this.n),
      BigMath.mod(b34Inv * b3, this.n),
      BigMath.mod(b56Inv * b6, this.n),
      BigMath.mod(b56Inv * b5, this.n),
      BigMath.mod(b1234567Inv * b123456, this.n)
    ];
  }

  fsChal(C1, C2, C3, t, A, B, C, D, E, msg, verify) {
    assert(typeof C1 === 'bigint');
    assert(typeof C2 === 'bigint');
    assert(typeof C3 === 'bigint');
    assert(typeof t === 'bigint');
    assert(typeof A === 'bigint');
    assert(typeof B === 'bigint');
    assert(typeof C === 'bigint');
    assert(typeof D === 'bigint');
    assert(typeof E === 'bigint');
    assert(typeof msg === 'bigint');
    assert(typeof verify === 'boolean');

    const modBytes = this.size;
    const expBytes = (constants.EXPONENT_SIZE + 7) >>> 3;

    if (C1 < 0n
        || C2 < 0n
        || C3 < 0n
        || t < 0n
        || A < 0n
        || B < 0n
        || C < 0n
        || D < 0n
        || E < 0n
        || msg < 0n) {
      throw new RangeError('Negative parameters.');
    }

    const ctx = new SHA256();

    ctx.init();
    ctx.update(constants.HASH_PREFIX);
    ctx.update(this.nRaw);
    ctx.update(this.gRaw);
    ctx.update(this.hRaw);
    ctx.update(BigMath.encode(C1, modBytes));
    ctx.update(BigMath.encode(C2, modBytes));
    ctx.update(BigMath.encode(C3, modBytes));
    ctx.update(BigMath.encode(t, 4));
    ctx.update(BigMath.encode(A, modBytes));
    ctx.update(BigMath.encode(B, modBytes));
    ctx.update(BigMath.encode(C, modBytes));
    ctx.update(BigMath.encode(D, modBytes));
    ctx.update(BigMath.encode(E, expBytes));
    ctx.update(BigMath.encode(msg, 64));

    const key = ctx.final();
    const prng = new PRNG(key);
    const chal = prng.randomBits(constants.CHAL_BITS);

    let ell = prng.randomBits(constants.CHAL_BITS);

    if (!verify) {
      // For prover, call nextPrime on ell_r to get ell.
      ell = primes.nextPrime(ell, key, constants.ELLDIFF_MAX);
    }

    return [chal, ell, key];
  }

  expandSprime(s_prime) {
    const rng = new PRNG(BigMath.encode(s_prime, 32));
    return rng.randomBits(constants.EXPONENT_SIZE);
  }

  generate() {
    const s_prime = this._generate();
    return BigMath.encode(s_prime, 32);
  }

  _generate() {
    const s_prime = util.randomBits(256);
    return s_prime;
  }

  challenge(s_prime, key) {
    assert(Buffer.isBuffer(s_prime));

    if (s_prime.length !== 32)
      throw new Error('Invalid seed length.');

    if (!isSanePublicKey(key))
      throw new Error('Invalid RSA public key.');

    const s_prime_n = BigMath.decode(s_prime);
    const n_n = BigMath.decode(key.n);
    const C1 = this._challenge(s_prime_n, n_n);

    return BigMath.encode(C1, this.size);
  }

  _challenge(s_prime, n) {
    assert(typeof s_prime === 'bigint');
    assert(typeof n === 'bigint');

    if (s_prime <= 0n)
      throw new Error('Invalid parameters.');

    if (n <= 0n)
      throw new Error('Invalid RSA public key.');

    // The challenge: a commitment to the RSA modulus.
    const s = this.expandSprime(s_prime);

    if (s <= 0n)
      throw new Error('Invalid s value.');

    const C1 = this.reduce(this.powgh(n, s));

    if (C1 <= 0n)
      throw new Error('Invalid C1 value.');

    return C1;
  }

  encrypt(msg, key) {
    return rsa.encrypt(msg, key);
  }

  decrypt(ct, key) {
    return rsa.decrypt(ct, key);
  }

  validate(s_prime, C1, key) {
    assert(Buffer.isBuffer(s_prime));
    assert(Buffer.isBuffer(C1));

    if (s_prime.length !== 32)
      return false;

    if (C1.length !== this.size)
      return false;

    if (!isSanePrivateKey(key))
      return false;

    try {
      return this._validate(BigMath.decode(s_prime),
                            BigMath.decode(C1),
                            BigMath.decode(key.p),
                            BigMath.decode(key.q));
    } catch (e) {
      return false;
    }
  }

  _validate(s_prime, C1, p, q) {
    assert(typeof s_prime === 'bigint');
    assert(typeof C1 === 'bigint');
    assert(typeof p === 'bigint');
    assert(typeof q === 'bigint');

    if (s_prime <= 0n || C1 <= 0n || p <= 0n || q <= 0n)
      return false;

    const n = p * q;
    const bits = BigMath.bitLength(n);

    if (bits < constants.MIN_RSA_BITS
        || bits > constants.MAX_RSA_BITS) {
      return false;
    }

    const s = this.expandSprime(s_prime);

    if (s <= 0n)
      return false;

    const x = this.reduce(this.powgh(n, s));

    if (x <= 0n)
      return false;

    return C1 === x;
  }

  sign(msg, s_prime, key) {
    assert(Buffer.isBuffer(msg));
    assert(Buffer.isBuffer(s_prime));

    if (msg.length < 20 || msg.length > 64)
      throw new Error('Invalid message size.');

    if (s_prime.length !== 32)
      throw new Error('Invalid s_prime length.');

    if (!isSanePrivateKey(key))
      throw new Error('Invalid RSA private key.');

    const sig = this._sign(BigMath.decode(msg),
                           BigMath.decode(s_prime),
                           BigMath.decode(key.p),
                           BigMath.decode(key.q));

    return sig.encode(this.bits);
  }

  _sign(msg, s_prime, p, q) {
    assert(typeof msg === 'bigint');
    assert(typeof s_prime === 'bigint');
    assert(typeof p === 'bigint');
    assert(typeof q === 'bigint');

    if (msg <= 0n || s_prime <= 0n || p <= 0n || q <= 0n)
      throw new Error('Invalid parameters.');

    // The challenge: a commitment to the RSA modulus.
    const n = p * q;
    const bits = BigMath.bitLength(n);

    if (bits < constants.MIN_RSA_BITS
        || bits > constants.MAX_RSA_BITS) {
      throw new Error('Invalid RSA private key.');
    }

    const s = this.expandSprime(s_prime);

    if (s <= 0n)
      throw new Error('Invalid s value.');

    const C1 = this.reduce(this.powgh(n, s));

    if (C1 <= 0n)
      throw new Error('Invalid C1 value.');

    // Preliminaries: compute values P needs to run the ZKPOK.
    // Find `t`.
    let w = null;
    let t = null;

    for (let i = 0; i < primes.smallPrimes.length; i++) {
      t = primes.smallPrimes[i];
      w = util.modSqrtN(t, p, q);

      if (w != null)
        break;
    }

    if (w == null || t == null)
      throw new Error('No prime quadratic residue less than 1000 mod N!');

    assert(w > 0n);

    const a = (w ** 2n - t) / n;

    assert(a >= 0n);

    if (a * n !== w ** 2n - t)
      throw new Error('w^2 - t was not divisible by N!');

    // Commitment to `w`.
    const s1 = this.randomScalar();
    const C2 = this.reduce(this.powgh(w, s1));

    // Commitment to `a`.
    const s2 = this.randomScalar();
    const C3 = this.reduce(this.powgh(a, s2));

    // Inverses of `C1` and `C2`.
    const [C1Inv, C2Inv] = this.inv2(C1, C2);

    // P's first message: commit to randomness.
    // P's randomness (except for r_s1; see "V's message", below).
    let [r_w, r_w2, r_a, r_an, r_s1w, r_sa, r_s2] = [
      this.randomScalar(),
      this.randomScalar(),
      this.randomScalar(),
      this.randomScalar(),
      this.randomScalar(),
      this.randomScalar(),
      this.randomScalar()
    ];

    // Prevent E from being negative.
    if (r_w2 < r_an)
      [r_w2, r_an] = [r_an, r_w2];

    // P's first message (except for A; see "V's message", below).
    const B = this.reduce(this.powgh(r_a, r_s2));
    const C = this.reduce(this.mul(this.pow(C2Inv, C2, r_w),
                                   this.powgh(r_w2, r_s1w)));
    const D = this.reduce(this.mul(this.pow(C1Inv, C1, r_a),
                                   this.powgh(r_an, r_sa)));
    const E = r_w2 - r_an;

    assert(E >= 0n);

    // V's message: random challenge and random prime.
    let chal = null;
    let ell = null;
    let r_s1, A;

    while (ell == null || BigMath.bitLength(ell) !== 128) {
      // Randomize the signature until Fiat-Shamir
      // returns an admissable ell. Note that it's
      // not necessary to re-start the whole
      // signature! Just pick a new r_s1, which
      // only requires re-computing A.
      r_s1 = this.randomScalar();
      A = this.reduce(this.powgh(r_w, r_s1));
      [chal, ell] = this.fsChal(C1, C2, C3, t, A, B, C, D, E, msg, false);
    }

    // P's second message: compute quotient message.
    // Compute z' = c*(w, w2, s1, a, an, s1w, sa, s2)
    //            + (r_w, r_w2, r_s1, r_a, r_an, r_s1w, r_sa, r_s2)
    const z_w = chal * w + r_w;
    const z_w2 = chal * w * w + r_w2;
    const z_s1 = chal * s1 + r_s1;
    const z_a = chal * a + r_a;
    const z_an = chal * a * n + r_an;
    const z_s1w = chal * s1 * w + r_s1w;
    const z_sa = chal * s * a + r_sa;
    const z_s2 = chal * s2 + r_s2;

    // Compute quotient commitments.
    const Aq = this.reduce(this.powgh(z_w / ell, z_s1 / ell));
    const Bq = this.reduce(this.powgh(z_a / ell, z_s2 / ell));
    const Cq = this.reduce(this.mul(this.pow(C2Inv, C2, z_w / ell),
                                    this.powgh(z_w2 / ell, z_s1w / ell)));
    const Dq = this.reduce(this.mul(this.pow(C1Inv, C2, z_a / ell),
                                    this.powgh(z_an / ell, z_sa / ell)));
    const Eq = BigMath.div(z_w2 - z_an, ell);

    if (Eq < 0n || BigMath.bitLength(Eq) > constants.EXPONENT_SIZE)
      throw new Error(`Invalid Eq: (${z_w2} - ${z_an}) / ${ell} = ${Eq}.`);

    // Compute z'.
    const z_prime = [];

    for (const z_foo of [z_w, z_w2, z_s1, z_a, z_an, z_s1w, z_sa, z_s2])
      z_prime.push(BigMath.mod(z_foo, ell));

    // z_prime: (z_w, z_w2, z_s1, z_a, z_an, z_s1w, z_sa, z_s2).
    // Signature: (chal, ell, Aq, Bq, Cq, Dq, Eq, z_prime).
    return new Signature({ C2,
                           C3,
                           t,
                           chal,
                           ell,
                           Aq,
                           Bq,
                           Cq,
                           Dq,
                           Eq,
                           z_prime });
  }

  verify(msg, sig, C1) {
    assert(Buffer.isBuffer(msg));
    assert(Buffer.isBuffer(sig));
    assert(Buffer.isBuffer(C1));

    if (msg.length < 20 || msg.length > 64)
      return false;

    if (C1.length !== this.size)
      return false;

    const m = BigMath.decode(msg);
    const c = BigMath.decode(C1);

    let s;

    try {
      s = Signature.decode(sig, this.bits);
    } catch (e) {
      return false;
    }

    try {
      return this._verify(m, s, c);
    } catch (e) {
      return false;
    }
  }

  _verify(msg, sig, C1) {
    assert(typeof msg === 'bigint');
    assert(sig instanceof Signature);
    assert(typeof C1 === 'bigint');

    const {C2, C3, t} = sig;
    const {chal, ell, Aq, Bq, Cq, Dq, Eq} = sig;
    const {z_w, z_w2, z_s1, z_a, z_an, z_s1w, z_sa, z_s2} = sig;

    if (C1 < 0n
        || C2 < 0n
        || C3 < 0n
        || t < 0n
        || chal < 0n
        || ell < 0n
        || Aq < 0n
        || Bq < 0n
        || Cq < 0n
        || Dq < 0n
        || Eq < 0n
        || z_w < 0n
        || z_w2 < 0n
        || z_s1 < 0n
        || z_a < 0n
        || z_an < 0n
        || z_s1w < 0n
        || z_sa < 0n
        || z_s2 < 0n) {
      throw new Error('Invalid parameters.');
    }

    if (BigMath.bitLength(ell) > 128)
      throw new Error('Invalid ell value.');

    // Make sure that the public key is valid.
    // `t` must be one of the small primes in our list.
    if (primes.smallPrimes.indexOf(t) === -1)
      throw new Error('Invalid small prime.');

    // All group elements must be the "canonical"
    // element of the quotient group (Z/n)/{1,-1}.
    for (const b of [C1, C2, C3, Aq, Bq, Cq, Dq]) {
      if (!this.isReduced(b))
        throw new Error('Non-reduced parameters.');
    }

    // Compute inverses of C1, C2, C3, Aq, Bq, Cq, Dq.
    //
    // Note:
    // Since we're inverting C1, C2, and C3, we can
    // get inverses of Aq, Bq, Cq, and Dq for ~free.
    // This lets us use signed-digit exponentiation
    // below, which is much faster.
    const [C1Inv, C2Inv, C3Inv,
           AqInv, BqInv, CqInv, DqInv] = this.inv7(C1, C2, C3, Aq, Bq, Cq, Dq);

    // Step 1: reconstruct A, B, C, D, and E from signature.
    const A = this.reduce(this.mul(this.pow2(Aq, AqInv, ell, C2Inv, C2, chal),
                                   this.powgh(z_w, z_s1)));
    const B = this.reduce(this.mul(this.pow2(Bq, BqInv, ell, C3Inv, C3, chal),
                                   this.powgh(z_a, z_s2)));
    const C = this.reduce(this.mul(this.pow2(Cq, CqInv, ell, C2Inv, C2, z_w),
                                   this.powgh(z_w2, z_s1w)));
    const D = this.reduce(this.mul(this.pow2(Dq, DqInv, ell, C1Inv, C1, z_a),
                                   this.powgh(z_an, z_sa)));

    // Make sure sign of (z_w2 - z_an) is positive.
    const z_w2_m_an = z_w2 - z_an;

    let E = Eq * ell + z_w2_m_an - t * chal;

    if (z_w2_m_an < 0n)
      E += ell;

    if (E < 0n)
      throw new Error(`Negative E value: ${E}.`);

    // Step 2: recompute implicitly claimed V message, viz., chal and ell.
    const [chal_out, ell_r_out, key] =
      this.fsChal(C1, C2, C3, t, A, B, C, D, E, msg, true);

    // Final checks.
    // chal has to match
    // AND 0 <= (ell_r_out - ell) <= ELLDIFF_MAX
    // AND ell is prime
    const elldiff = ell - ell_r_out;

    if (chal !== chal_out
        || elldiff < 0n
        || elldiff > BigInt(constants.ELLDIFF_MAX)
        || !primes.isPrime(ell, key)) {
      throw new Error('Invalid chal/ell values.');
    }

    return true;
  }

  toJSON() {
    return {
      n: BigMath.toString(this.n, 16, 2),
      nh: BigMath.toString(this.nh, 16, 2),
      g: Number(this.g),
      h: Number(this.h),
      randBits: this.randBits,
      combs: this.combs.map((combs) => {
        return {
          g: combs.g.toJSON(),
          h: combs.h.toJSON()
        };
      })
    };
  }

  static encrypt(msg, key, bits) {
    return rsa.encrypt(msg, key, bits);
  }

  static decrypt(ct, key, bits) {
    return rsa.decrypt(ct, key, bits);
  }
}

/*
 * Static
 */

Goo.native = 0;
Goo.AOL1 = constants.AOL1;
Goo.AOL2 = constants.AOL2;
Goo.RSA2048 = constants.RSA2048;
Goo.RSA617 = constants.RSA617;

/*
 * Comb
 */

class Comb {
  constructor(goo, base, spec) {
    this.pointsPerAdd = 0;
    this.addsPerShift = 0;
    this.shifts = 0;
    this.bitsPerWindow = 0;
    this.bits = 0;
    this.pointsPerSubcomb = 0;
    this.items = [];
    this.wins = [];

    if (goo != null)
      this.init(goo, base, spec);
  }

  init(goo, base, spec) {
    assert(goo && typeof goo.mul === 'function');
    assert(typeof base === 'bigint');
    assert(Array.isArray(spec));
    assert(spec.length === 6);
    assert((spec[0] >>> 0) === spec[0]);
    assert((spec[1] >>> 0) === spec[1]);
    assert((spec[2] >>> 0) === spec[2]);
    assert((spec[3] >>> 0) === spec[3]);
    assert((spec[4] >>> 0) === spec[4]);
    assert((spec[5] >>> 0) === spec[5]);

    const [ppa, aps, shifts, bpw, , size] = spec;
    const skip = 2 ** ppa - 1;
    const window = 1n << BigInt(bpw);
    const powval = 1n << BigInt(shifts);

    this.pointsPerAdd = ppa;
    this.addsPerShift = aps;
    this.shifts = shifts;
    this.bitsPerWindow = bpw;
    this.bits = bpw * ppa;
    this.pointsPerSubcomb = skip;

    // Allocate space.
    this.items = [];

    for (let i = 0; i < size; i++)
      this.items.push(0n);

    // Compute bottom comb.
    this.items[0] = base;

    for (let i = 1; i < ppa; i++) {
      const x = 2 ** i;
      const y = x >>> 1;

      this.items[x - 1] = goo.pow(this.items[y - 1], null, window);

      for (let j = x + 1; j < 2 * x; j++)
        this.items[j - 1] = goo.mul(this.items[j - x - 1], this.items[x - 1]);
    }

    for (let i = 1; i < aps; i++) {
      for (let j = 0; j < skip; j++) {
        const k = i * skip + j;
        const n = this.items[k - skip];

        this.items[k] = goo.pow(n, null, powval);
      }
    }

    for (let i = 0; i < this.shifts; i++)
      this.wins.push(new Int32Array(this.addsPerShift));
  }

  toCombExp(e) {
    assert(typeof e === 'bigint');

    for (let i = this.addsPerShift - 1; i >= 0; i--) {
      for (let j = 0; j < this.shifts; j++) {
        let ret = 0;
        for (let k = 0; k < this.pointsPerAdd; k++) {
          const b = (i + k * this.addsPerShift) * this.shifts + j;
          ret *= 2;
          ret += Number((e >> BigInt((this.bits - 1) - b)) & 1n);
        }
        this.wins[j][(this.addsPerShift - 1) - i] = ret;
      }
    }

    return this.wins;
  }

  toJSON() {
    return {
      base: BigMath.toString(this.items[0], 16, 2),
      pointsPerAdd: this.pointsPerAdd,
      addsPerShift: this.addsPerShift,
      shifts: this.shifts,
      bitsPerWindow: this.bitsPerWindow,
      bits: this.bits,
      pointsPerSubcomb: this.pointsPerSubcomb,
      size: this.items.length,
      items: this.items.map(item => BigMath.toString(item, 16, 2))
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');
    assert((json.pointsPerAdd >>> 0) === json.pointsPerAdd);
    assert((json.addsPerShift >>> 0) === json.addsPerShift);
    assert((json.shifts >>> 0) === json.shifts);
    assert((json.bitsPerWindow >>> 0) === json.bitsPerWindow);
    assert((json.bits >>> 0) === json.bits);
    assert((json.pointsPerSubcomb >>> 0) === json.pointsPerSubcomb);
    assert((json.size >>> 0) === json.size);
    assert(Array.isArray(json.items));

    this.pointsPerAdd = json.pointsPerAdd;
    this.addsPerShift = json.addsPerShift;
    this.shifts = json.shifts;
    this.bitsPerWindow = json.bitsPerWindow;
    this.bits = json.bits;
    this.pointsPerSubcomb = json.pointsPerSubcomb;

    for (const item of json.items)
      this.items.push(BigMath.fromString(item, 16));

    return this;
  }

  static generate(bits, maxSize) {
    assert((bits >>> 0) === bits);
    assert((maxSize >>> 0) === maxSize);

    // An "optimal" comb for a given #ops is
    // the one that uses the least storage
    // for a given storage size is the one
    // that uses the least ops.
    const combs = new Map();

    const genComb = (shifts, aps, ppa, bpw) => {
      // Note:
      // This assumes add/mull and double/square have the same cost;
      // you might adjust this to get a better optimization result!
      const ops = shifts * (aps + 1) - 1;
      const size = (2 ** ppa - 1) * aps;
      const item = [ppa, aps, shifts, bpw, ops, size];
      const best = combs.get(ops);

      if (best == null || best[5] > size)
        combs.set(ops, item);
    };

    for (let ppa = 2; ppa < 18; ppa++) {
      const bpw = ((bits + ppa - 1) / ppa) >>> 0;
      const sqrt = util.dsqrt(bpw);

      for (let aps = 1; aps < sqrt + 2; aps++) {
        if (bpw % aps !== 0) {
          // Only factorizations of
          // bpw are useful.
          continue;
        }

        const shifts = (bpw / aps) >>> 0;

        genComb(shifts, aps, ppa, bpw);
        genComb(aps, shifts, ppa, bpw);
      }
    }

    const keys = [];

    for (const key of combs.keys())
      keys.push(key);

    keys.sort((a, b) => a - b);

    let ret = null;
    let sm = null;

    for (const ops of keys) {
      const comb = combs.get(ops);

      if (sm != null && sm <= comb[5])
        continue;

      sm = comb[5];

      if (sm <= maxSize) {
        ret = comb;
        break;
      }
    }

    if (!ret)
      throw new Error('Could not calculate comb.');

    return ret;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }
}

/*
 * Helpers
 */

function isSanePublicKey(key) {
  assert(key && typeof key === 'object');

  const klen = util.countBits(key.n);

  return klen >= constants.MIN_RSA_BITS
      && klen <= constants.MAX_RSA_BITS;
}

function isSanePrivateKey(key) {
  assert(key && typeof key === 'object');

  const plen = util.countBits(key.p);
  const qlen = util.countBits(key.q);

  return plen <= constants.MAX_RSA_BITS
      && qlen <= constants.MAX_RSA_BITS;
}

/*
 * Expose
 */

module.exports = Goo;
