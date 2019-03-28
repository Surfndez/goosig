/*!
 * bigmath.js - bigmath for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/handshake-org/goosig
 *
 * Parts of this software are based on golang/go:
 *   Copyright (c) 2009 The Go Authors. All rights reserved.
 *   https://github.com/golang/go
 *
 * Resources:
 *   https://github.com/golang/go/blob/master/src/math/big/int.go
 *   https://github.com/golang/go/blob/master/src/math/big/nat.go
 */

/* eslint valid-typeof: "off" */

'use strict';

const assert = require('bsert');

/*
 * Constants
 */

const MAX_SAFE_INTEGER = 9007199254740991n;

/*
 * BigMath
 */

function byteLength(x) {
  assert(typeof x === 'bigint');

  if (x === 0n)
    return 0;

  if (x < 0n)
    x = -x;

  let i = 0;

  while (x > 0n) {
    i += 1;
    x >>= 8n;
  }

  return i;
}

function bitLength(x) {
  assert(typeof x === 'bigint');

  if (x === 0n)
    return 0;

  if (x < 0n)
    x = -x;

  let i = 0;

  while (x > 0n) {
    i += 1;
    x >>= 1n;
  }

  return i;
}

function zeroBits(x) {
  assert(typeof x === 'bigint');

  if (x === 0n)
    return 0;

  if (x < 0n)
    x = -x;

  let i = 0;

  while ((x & 1n) === 0n) {
    i += 1;
    x >>= 1n;
  }

  return i;
}

function abs(x) {
  assert(typeof x === 'bigint');
  return x < 0n ? -x : x;
}

function max(a, b) {
  assert(typeof a === 'bigint');
  assert(typeof b === 'bigint');
  return a > b ? a : b;
}

function min(a, b) {
  assert(typeof a === 'bigint');
  assert(typeof b === 'bigint');
  return a < b ? a : b;
}

function _div(x, y) {
  if ((x < 0n) !== (y < 0n)) {
    if (x % y !== 0n)
      return (x / y) - 1n;
  }

  return x / y;
}

function div(x, y) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  return _div(x, y);
}

function _mod(x, y) {
  x %= y;

  if (y < 0n) {
    if (x > 0n)
      x += y;
  } else {
    if (x < 0n)
      x += y;
  }

  return x;
}

function mod(x, y) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  return _mod(x, y);
}

function divmod(x, y) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  return [_div(x, y), _mod(x, y)];
}

// https://github.com/golang/go/blob/aadaec5/src/math/big/nat.go#L1335
function sqrt(x) {
  assert(typeof x === 'bigint');

  if (x <= 1n)
    return x;

  // See https://members.loria.fr/PZimmermann/mca/pub226.html.
  let z1 = 1n;

  z1 <<= BigInt((bitLength(x) >>> 1) + 1);

  for (;;) {
    let z2 = x / z1;
    z2 += z1;
    z2 >>= 1n;

    if (z2 >= z1)
      return z1;

    z1 = z2;
  }
}

function gcd(a, b) {
  assert(typeof a === 'bigint');
  assert(typeof b === 'bigint');

  while (b !== 0n)
    [a, b] = [b, _mod(a, b)];

  return a;
}

function egcd(a, b) {
  assert(typeof a === 'bigint');
  assert(typeof b === 'bigint');

  let s = 0n;
  let os = 1n;
  let t = 1n;
  let ot = 0n;
  let r = b;
  let or = a;

  while (r !== 0n) {
    const q = _div(or, r);

    [or, r] = [r, or - q * r];
    [os, s] = [s, os - q * s];
    [ot, t] = [t, ot - q * t];
  }

  return [os, ot, or];
}

function inverse(a, n) {
  assert(typeof a === 'bigint');
  assert(typeof n === 'bigint');

  a = _mod(a, n);

  let t = 0n;
  let nt = 1n;
  let r = n;
  let nr = a;

  while (nr !== 0n) {
    const q = _div(r, nr);

    [t, nt] = [nt, t - q * nt];
    [r, nr] = [nr, r - q * nr];
  }

  if (r > 1n)
    throw new Error('Not invertible.');

  return _mod(t, n);
}

// https://github.com/golang/go/blob/aadaec5/src/math/big/int.go#L754
function jacobi(x, y) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');

  if (y === 0n || (y & 1n) === 0n)
    throw new Error('jacobi: `y` must be odd.');

  // See chapter 2, section 2.4:
  // http://yacas.sourceforge.net/Algo.book.pdf
  let a = x;
  let b = y;
  let j = 1;

  if (b < 0n) {
    if (a < 0n)
      j = -1;
    b = -b;
  }

  for (;;) {
    if (b === 1n)
      return j;

    if (a === 0n)
      return 0;

    a = _mod(a, b);

    if (a === 0n)
      return 0;

    const s = zeroBits(a);

    if (s & 1) {
      const bmod8 = b & 7n;

      if (bmod8 === 3n || bmod8 === 5n)
        j = -j;
    }

    const c = a >> BigInt(s);

    if ((b & 3n) === 3n && (c & 3n) === 3n)
      j = -j;

    a = b;
    b = c;
  }
}

function modAdd(x, y, m) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  assert(typeof m === 'bigint');

  return _mod(x + y, m);
}

function modSub(x, y, m) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  assert(typeof m === 'bigint');

  return _mod(x - y, m);
}

function modMul(x, y, m) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  assert(typeof m === 'bigint');

  return _mod(x * y, m);
}

function modDiv(x, y, m) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  assert(typeof m === 'bigint');

  return _mod(_div(x, y), m);
}

function modSqr(x, m) {
  assert(typeof x === 'bigint');
  assert(typeof m === 'bigint');

  return _mod(x * x, m);
}

// https://github.com/golang/go/blob/c86d464/src/math/big/int.go#L906
function modSqrt(x, p) {
  assert(typeof x === 'bigint');
  assert(typeof p === 'bigint');

  switch (jacobi(x, p)) {
    case -1:
      throw new Error('X is not a square mod P.');
    case 0:
      return 0n;
    case 1:
      break;
  }

  if (x < 0n || x >= p)
    x = _mod(x, p);

  if ((p & 3n) === 3n) {
    const e = (p + 1n) >> 2n;
    return modPow(x, e, p);
  }

  if ((p & 7n) === 5n) {
    const e = p >> 3n;
    const t = x << 1n;
    const a = modPow(t, e, p);

    let b = 0n;

    b = a * a;
    b = _mod(b, p);

    b *= t;
    b = _mod(b, p);

    b -= 1n;
    b *= x;
    b = _mod(b, p);

    b *= a;
    b = _mod(b, p);

    return b;
  }

  let s = p - 1n;

  const e = BigInt(zeroBits(s));

  s >>= e;

  let n = 2n;

  while (jacobi(n, p) !== -1)
    n += 1n;

  let y = 0n;
  let b = 0n;
  let g = 0n;

  y = s + 1n;
  y >>= 1n;
  y = modPow(x, y, p);
  b = modPow(x, s, p);
  g = modPow(n, s, p);

  let r = e;
  let t = 0n;

  for (;;) {
    let m = 0n;

    t = b;

    while (t !== 1n) {
      t = _mod(t * t, p);
      m += 1n;
    }

    if (m === 0n)
      break;

    t = 1n << (r - m - 1n);
    t = modPow(g, t, p);
    g = _mod(t * t, p);
    y = _mod(y * t, p);
    b = _mod(b * g, p);
    r = m;
  }

  return y;
}

function modPow(x, y, m) {
  assert(typeof x === 'bigint');
  assert(typeof y === 'bigint');
  assert(typeof m === 'bigint');
  assert(y >= 0n);

  if (m === 0n)
    throw new Error('Cannot divide by zero.');

  if (m === 1n)
    return 0n;

  if (x === 0n)
    return 0n;

  // GMP behavior.
  if (y < 0n) {
    x = inverse(x, m);
    y = -y;
  } else {
    x = _mod(x, m);
  }

  let r = 1n;

  while (y > 0n) {
    if ((y & 1n) === 1n)
      r = _mod(r * x, m);

    y >>= 1n;
    x = _mod(x * x, m);
  }

  return r;
}

function encode(num, pad = 0, le = false) {
  if (typeof pad === 'boolean')
    [pad, le] = [le, pad];

  assert(typeof num === 'bigint');
  assert((pad >>> 0) === pad);
  assert(typeof le === 'boolean');

  if (num < 0n)
    num = -num;

  let str = num.toString(16);

  if (str.length & 1)
    str = '0' + str;

  if (pad !== 0) {
    let len = str.length >>> 1;

    if (len > pad)
      throw new RangeError('Number too large.');

    while (len < pad) {
      str = '00' + str;
      len += 1;
    }
  }

  const out = Buffer.from(str, 'hex');

  if (le) {
    let i = out.length - 1;
    let j = 0;

    while (i > j) {
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
      i -= 1;
      j += 1;
    }
  }

  return out;
}

function decode(buf, le = false) {
  assert(Buffer.isBuffer(buf));
  assert(typeof le === 'boolean');

  let n = 0n;

  if (!le) {
    for (let i = 0; i < buf.length; i++) {
      n <<= 8n;
      n |= BigInt(buf[i]);
    }
  } else {
    for (let i = buf.length - 1; i >= 0; i--) {
      n <<= 8n;
      n |= BigInt(buf[i]);
    }
  }

  return n;
}

function size(num, pad = 0) {
  assert(typeof num === 'bigint');
  assert((pad >>> 0) === pad);

  if (num < 0n)
    num = -num;

  const len = (num.toString(16).length + 1) >>> 1;

  if (pad !== 0) {
    if (len > pad)
      throw new RangeError('Number too large.');
  }

  return len;
}

function write(data, num, off, pad = 0, le = false) {
  if (typeof pad === 'boolean')
    [pad, le] = [le, pad];

  assert(Buffer.isBuffer(data));
  assert(typeof num === 'bigint');
  assert((off >>> 0) === off);
  assert((pad >>> 0) === pad);
  assert(typeof le === 'boolean');

  if (num < 0n)
    num = -num;

  let str = num.toString(16);

  if (str.length & 1)
    str = '0' + str;

  if (pad !== 0) {
    let len = str.length >>> 1;

    if (len > pad)
      throw new RangeError('Number too large.');

    while (len < pad) {
      str = '00' + str;
      len += 1;
    }
  }

  const w = data.write(str, off, 'hex');

  if (w !== (str.length >>> 1))
    throw new RangeError('Out of bounds write.');

  if (le) {
    let i = (off + w) - 1;
    let j = off;

    while (i > j) {
      const t = data[i];
      data[i] = data[j];
      data[j] = t;
      i -= 1;
      j += 1;
    }
  }

  return off + w;
}

function read(data, off, size, le = false) {
  assert(Buffer.isBuffer(data));
  assert((off >>> 0) === off);
  assert((size >>> 0) === size);
  assert(typeof le === 'boolean');

  let n = 0n;

  const len = off + size;

  if (len > data.length)
    throw new RangeError('Out of bounds read.');

  if (!le) {
    for (let i = off; i < len; i++) {
      n <<= 8n;
      n |= BigInt(data[i]);
    }
  } else {
    for (let i = len - 1; i >= off; i--) {
      n <<= 8n;
      n |= BigInt(data[i]);
    }
  }

  return n;
}

function writeBW(bw, num, pad, le) {
  assert(bw && typeof bw.writeU8 === 'function');
  bw.offset = write(bw.data, num, bw.offset, pad, le);
  return bw;
}

function readBR(br, size, le) {
  assert(br && typeof br.readU8 === 'function');
  const num = read(br.data, br.offset, size, le);
  br.offset += size;
  return num;
}

function toNumber(num) {
  assert(typeof num === 'bigint');

  if (num < -MAX_SAFE_INTEGER
      || num > MAX_SAFE_INTEGER) {
    throw new RangeError('Integer exceeds 2^53-1.');
  }

  return Number(num);
}

function fromNumber(num) {
  assert(typeof num === 'number');

  if (!Number.isSafeInteger(num))
    throw new TypeError('Invalid integer.');

  return BigInt(num);
}

function toDouble(num) {
  assert(typeof num === 'bigint');
  return Number(num);
}

function fromDouble(num) {
  assert(typeof num === 'number');

  if (!isFinite(num) || (num % 1) !== 0)
    throw new TypeError('Invalid integer.');

  return BigInt(num);
}

function toString(num, base, pad) {
  base = getBase(base);

  if (pad == null)
    pad = 0;

  if (pad === 0)
    pad = 1;

  assert(typeof num === 'bigint');
  assert((base >>> 0) === base);
  assert((pad >>> 0) === pad);

  if (base < 2 || base > 36)
    throw new RangeError('Base ranges between 2 and 36.');

  let neg = false;

  if (num < 0n) {
    neg = true;
    num = -num;
  }

  let str = num.toString(base);

  while (str.length % pad)
    str = '0' + str;

  if (neg)
    str = '-' + str;

  return str;
}

function fromString(str, base) {
  base = getBase(base);

  assert(typeof str === 'string');
  assert((base >>> 0) === base);

  if (base < 2 || base > 36)
    throw new RangeError('Base ranges between 2 and 36.');

  if (_isFastBase(base))
    return _fromStringFast(str, base);

  let neg = false;
  let i = 0;

  for (; i < str.length; i++) {
    const ch = str.charCodeAt(i);

    switch (ch) {
      case 0x09: // '\t'
      case 0x0a: // '\n'
      case 0x0d: // '\r'
      case 0x20: // ' '
        continue;
    }

    break;
  }

  if (i < str.length && str[i] === '-') {
    neg = true;
    i += 1;
  }

  const big = BigInt(base);

  let num = 0n;
  let saw = false;

  for (; i < str.length; i++) {
    let ch = str.charCodeAt(i);

    switch (ch) {
      case 0x09: // '\t'
      case 0x0a: // '\n'
      case 0x0d: // '\r'
      case 0x20: // ' '
        continue;
    }

    if (ch >= 0x30 && ch <= 0x39)
      ch -= 0x30;
    else if (ch >= 0x41 && ch <= 0x5a)
      ch -= 0x41 - 10;
    else if (ch >= 0x61 && ch <= 0x7a)
      ch -= 0x61 - 10;
    else
      ch = base;

    if (ch >= base)
      throw new Error('Invalid string (parse error).');

    num *= big;
    num += BigInt(ch);

    saw = true;
  }

  if (!saw)
    throw new Error('Invalid string (bad length).');

  if (neg)
    num = -num;

  return num;
}

function _isFastBase(base) {
  switch (base) {
    case 2:
    case 8:
    case 10:
    case 16:
      return true;
  }
  return false;
}

function _fromStringFast(str, base) {
  let neg = false;
  let num;

  str = str.replace(/[\t\n\r ]/g, '');

  if (str.length > 0 && str[0] === '-') {
    str = str.substring(1);
    neg = true;
  }

  if (str.length === 0)
    throw new Error('Invalid string (bad length).');

  switch (base) {
    case 2:
      str = '0b' + str;
      break;
    case 8:
      str = '0o' + str;
      break;
    case 10:
      if (str.length > 1) {
        const ch = str.charCodeAt(1);
        if (ch < 0x30 || ch > 0x39)
          throw new Error('Invalid string (parse error).');
      }
      break;
    case 16:
      str = '0x' + str;
      break;
    default:
      throw new Error('Invalid base.');
  }

  try {
    num = BigInt(str);
  } catch (e) {
    throw new Error('Invalid string (parse error).');
  }

  if (neg)
    num = -num;

  return num;
}

function toJSON(num) {
  return toString(num, 16, 2);
}

function fromJSON(str) {
  return fromString(str, 16);
}

function toBuffer(num, pad, le) {
  return encode(num, pad, le);
}

function fromBuffer(num, le) {
  return decode(num, le);
}

function toBN(BN, num) {
  assert(typeof BN === 'function');
  assert(typeof num === 'bigint');

  let neg = false;

  if (num < 0n) {
    num = -num;
    neg = true;
  }

  const b = new BN();

  b.negative = 0;
  b.words = [];
  b.length = 0;

  while (num > 0n) {
    b.words[b.length] = Number(num & 0x3ffffffn);
    b.length += 1;
    num >>= 26n;
  }

  if (neg)
    b.negative = 1;

  return b;
}

function fromBN(b) {
  assert(b && typeof b === 'object');
  assert((b.length >>> 0) === b.length);
  assert(b.words === null || Array.isArray(b.words));
  assert(b.length > 0 && b.words);

  let num = 0n;

  for (let i = b.length - 1; i >= 0; i--) {
    num <<= 26n;
    num |= BigInt(b.words[i] & 0x3ffffff);
  }

  if (b.negative)
    num = -num;

  return num;
}

/*
 * Helpers
 */

function getBase(base) {
  if (base == null)
    return 10;

  if (typeof base === 'number')
    return base;

  switch (base) {
    case 'bin':
      return 2;
    case 'oct':
      return 8;
    case 'dec':
      return 10;
    case 'hex':
      return 16;
  }

  return 0;
}

/*
 * Expose
 */

exports.byteLength = byteLength;
exports.bitLength = bitLength;
exports.zeroBits = zeroBits;
exports.abs = abs;
exports.min = min;
exports.max = max;
exports.div = div;
exports.mod = mod;
exports.divmod = divmod;
exports.sqrt = sqrt;
exports.gcd = gcd;
exports.egcd = egcd;
exports.inverse = inverse;
exports.jacobi = jacobi;
exports.modAdd = modAdd;
exports.modSub = modSub;
exports.modMul = modMul;
exports.modDiv = modDiv;
exports.modSqr = modSqr;
exports.modSqrt = modSqrt;
exports.modPow = modPow;
exports.encode = encode;
exports.decode = decode;
exports.size = size;
exports.write = write;
exports.read = read;
exports.writeBW = writeBW;
exports.readBR = readBR;
exports.toNumber = toNumber;
exports.fromNumber = fromNumber;
exports.toDouble = toDouble;
exports.fromDouble = fromDouble;
exports.toString = toString;
exports.fromString = fromString;
exports.toJSON = toJSON;
exports.fromJSON = fromJSON;
exports.toBuffer = toBuffer;
exports.fromBuffer = fromBuffer;
exports.toBN = toBN;
exports.fromBN = fromBN;
