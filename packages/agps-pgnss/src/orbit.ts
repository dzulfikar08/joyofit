// Orbit maths: the ICD broadcast Keplerian model (GPS, QZSS, Galileo, BeiDou MEO/IGSO) with its least-squares fit to a tabulated orbit, and the
// GLONASS ICD state-vector model (J2 + constant luni-solar acceleration) with the Sun and Moon terms it needs.
//
// Formulas: IS-GPS-200 table 20-IV (also QZSS IS-QZSS-PNT, Galileo OS SIS ICD 5.1.1, BDS-SIS-ICD-B1I 5.2.4.12 for MEO/IGSO), GLONASS ICD 5.1
// appendix A.3.1.2. Sun and Moon: Montenbruck & Gill, "Satellite Orbits" 3.3.2 (low-precision series, about 0.1 degree).

export type Constellation = 'G' | 'J' | 'E' | 'C';

/** Constants each ICD uses in its user algorithm; a record must be fitted with the ones the receiver will evaluate it with. */
export const ICD: Record<Constellation, { mu: number; omegaE: number }> = {
  G: { mu: 3.986005e14, omegaE: 7.2921151467e-5 },
  J: { mu: 3.986005e14, omegaE: 7.2921151467e-5 },
  E: { mu: 3.986004418e14, omegaE: 7.2921151467e-5 },
  C: { mu: 3.986004418e14, omegaE: 7.292115e-5 },
};

/** Broadcast Keplerian elements, SI units, angles in radians. `toe` is seconds of the week in the constellation's own time. */
export type Elements = {
  sqrtA: number;
  e: number;
  i0: number;
  omega0: number;
  omega: number;
  m0: number;
  deltaN: number;
  omegaDot: number;
  idot: number;
  cuc: number;
  cus: number;
  crc: number;
  crs: number;
  cic: number;
  cis: number;
  toe: number;
};

/** The fitted parameters, in this order. */
export const FIT_KEYS = ['sqrtA', 'e', 'i0', 'omega0', 'omega', 'm0', 'deltaN', 'omegaDot', 'idot', 'cuc', 'cus', 'crc', 'crs', 'cic', 'cis'] as const;
const NP = FIT_KEYS.length;

/**
 * ECEF position [m] at `tk` seconds from toe (the caller handles week crossovers), written to out[0..2]. When `jac` is given, the partial
 * derivatives of X, Y, Z by each of [FIT_KEYS] are written to jac[3*p + axis].
 */
export function keplerPosition(el: Elements, tk: number, c: Constellation, out: Float64Array, jac?: Float64Array): void {
  const { mu, omegaE } = ICD[c];
  const A = el.sqrtA * el.sqrtA;
  const n0 = Math.sqrt(mu / (A * A * A));
  const n = n0 + el.deltaN;
  const M = el.m0 + n * tk;
  const e = el.e;
  let E = M;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-15) break;
  }
  const sinE = Math.sin(E);
  const cosE = Math.cos(E);
  const oneMinusECosE = 1 - e * cosE;
  const sq = Math.sqrt(1 - e * e);
  const nu = Math.atan2(sq * sinE, cosE - e);
  const phi = nu + el.omega;
  const s2 = Math.sin(2 * phi);
  const c2 = Math.cos(2 * phi);
  const u = phi + el.cus * s2 + el.cuc * c2;
  const r = A * oneMinusECosE + el.crs * s2 + el.crc * c2;
  const inc = el.i0 + el.idot * tk + el.cis * s2 + el.cic * c2;
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const xp = r * cu;
  const yp = r * su;
  const Om = el.omega0 + (el.omegaDot - omegaE) * tk - omegaE * el.toe;
  const cO = Math.cos(Om);
  const sO = Math.sin(Om);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const X = xp * cO - yp * ci * sO;
  const Y = xp * sO + yp * ci * cO;
  const Z = yp * si;
  out[0] = X;
  out[1] = Y;
  out[2] = Z;
  if (!jac) return;

  // d(X,Y,Z) by r, u, i, Omega.
  const Xr = cu * cO - su * ci * sO;
  const Yr = cu * sO + su * ci * cO;
  const Zr = su * si;
  const Xu = -r * su * cO - r * cu * ci * sO;
  const Yu = -r * su * sO + r * cu * ci * cO;
  const Zu = r * cu * si;
  const Xi = yp * si * sO;
  const Yi = -yp * si * cO;
  const Zi = yp * ci;
  const XO = -Y;
  const YO = X;
  const set = (p: number, dr: number, du: number, di: number, dO: number) => {
    jac[3 * p] = Xr * dr + Xu * du + Xi * di + XO * dO;
    jac[3 * p + 1] = Yr * dr + Yu * du + Yi * di + YO * dO;
    jac[3 * p + 2] = Zr * dr + Zu * du + Zi * di;
  };
  // Through phi (argument of latitude before corrections).
  const duDphi = 1 + 2 * (el.cus * c2 - el.cuc * s2);
  const drDphi = 2 * (el.crs * c2 - el.crc * s2);
  const diDphi = 2 * (el.cis * c2 - el.cic * s2);
  // Through M (mean anomaly) at fixed e: E, nu, r.
  const dEdM = 1 / oneMinusECosE;
  const dnuDM = sq / (oneMinusECosE * oneMinusECosE);
  const drDM = A * e * sinE * dEdM + drDphi * dnuDM;
  const duDM = duDphi * dnuDM;
  const diDM = diDphi * dnuDM;
  // sqrtA: A directly, and n0 through M.
  const dMdS = (-3 * n0 * tk) / el.sqrtA;
  set(0, 2 * el.sqrtA * oneMinusECosE + drDM * dMdS, duDM * dMdS, diDM * dMdS, 0);
  // e at fixed M.
  const dEde = sinE / oneMinusECosE;
  const dnuDe = sinE / (sq * oneMinusECosE) + (sq * sinE) / (oneMinusECosE * oneMinusECosE);
  set(1, A * (-cosE + e * sinE * dEde) + drDphi * dnuDe, duDphi * dnuDe, diDphi * dnuDe, 0);
  set(2, 0, 0, 1, 0); // i0
  set(3, 0, 0, 0, 1); // omega0
  set(4, drDphi, duDphi, diDphi, 0); // omega
  set(5, drDM, duDM, diDM, 0); // m0
  set(6, drDM * tk, duDM * tk, diDM * tk, 0); // deltaN
  set(7, 0, 0, 0, tk); // omegaDot
  set(8, 0, 0, tk, 0); // idot
  set(9, 0, c2, 0, 0); // cuc
  set(10, 0, s2, 0, 0); // cus
  set(11, c2, 0, 0, 0); // crc
  set(12, s2, 0, 0, 0); // crs
  set(13, 0, 0, c2, 0); // cic
  set(14, 0, 0, s2, 0); // cis
}

/**
 * Osculating elements at toe from an ECEF state (position [m], rotating-frame velocity [m/s]), as the starting point of the fit. The node is
 * expressed the ICD way (Omega0 = node longitude at toe + omegaE * toe).
 */
export function elementsFromState(s: Float64Array, toe: number, c: Constellation): Elements {
  const { mu, omegaE } = ICD[c];
  const [x, y, z, vx0, vy0, vz] = s as unknown as [number, number, number, number, number, number];
  // Inertial velocity in the frame that coincides with ECEF at toe.
  const vx = vx0 - omegaE * y;
  const vy = vy0 + omegaE * x;
  const r = Math.hypot(x, y, z);
  const v2 = vx * vx + vy * vy + vz * vz;
  const hx = y * vz - z * vy;
  const hy = z * vx - x * vz;
  const hz = x * vy - y * vx;
  const h = Math.hypot(hx, hy, hz);
  const a = 1 / (2 / r - v2 / mu);
  const rv = x * vx + y * vy + z * vz;
  // Eccentricity vector.
  const k1 = v2 / mu - 1 / r;
  const ex = k1 * x - (rv / mu) * vx;
  const ey = k1 * y - (rv / mu) * vy;
  const ez = k1 * z - (rv / mu) * vz;
  const e = Math.hypot(ex, ey, ez);
  const inc = Math.acos(hz / h);
  const node = Math.atan2(hx, -hy);
  // Argument of latitude, argument of perigee.
  const cN = Math.cos(node);
  const sN = Math.sin(node);
  const u = Math.atan2(z / Math.sin(inc), x * cN + y * sN);
  const omega = Math.atan2(ez / Math.sin(inc), ex * cN + ey * sN);
  const nu = u - omega;
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const M = E - e * Math.sin(E);
  // J2 node drift as the starting rate (the fit refines it).
  const J2 = 1.0826e-3;
  const RE = 6378137;
  const n = Math.sqrt(mu / (a * a * a));
  const p = a * (1 - e * e);
  const omegaDot = -1.5 * n * J2 * (RE / p) ** 2 * Math.cos(inc);
  return {
    sqrtA: Math.sqrt(a),
    e,
    i0: inc,
    omega0: node + omegaE * toe,
    omega,
    m0: M,
    deltaN: 0,
    omegaDot,
    idot: 0,
    cuc: 0,
    cus: 0,
    crc: 0,
    crs: 0,
    cic: 0,
    cis: 0,
    toe,
  };
}

export type Fit = { el: Elements; rms: number; iterations: number };

/**
 * Least-squares fit of the 15 broadcast parameters to `obs` (x, y, z [m] at the times `tk` from toe) by Gauss-Newton with Levenberg damping
 * and column scaling, starting from `start`. Near-circular orbits (Galileo e ~ 2e-4) make e, omega and M0 nearly degenerate, so the fit runs
 * on the non-singular set h = e sin(omega), k = e cos(omega), L = M0 + omega and converts back. At most [maxIter] iterations; stops when a
 * near-Gauss-Newton step changes the RMS by less than 0.1 % (Huawei Health's FitBceOrbit16: at most 12 iterations, 0.001). Returns null
 * when the fit diverges (non-finite, sqrtA <= 0, e outside [0, 1)).
 */
export function fitElements(start: Elements, tk: Float64Array, obs: Float64Array, c: Constellation, maxIter = 20): Fit | null {
  const m = tk.length;
  const pos = new Float64Array(3);
  const jac = new Float64Array(3 * NP);
  const N = new Float64Array(NP * NP);
  const b = new Float64Array(NP);
  // Parameter vector: FIT_KEYS order with e -> h (1), omega -> k (4), m0 -> L (5).
  const params = new Float64Array(NP);
  FIT_KEYS.forEach((key, i) => (params[i] = start[key]));
  const e0 = Math.max(start.e, 1e-9);
  params[1] = e0 * Math.sin(start.omega);
  params[4] = e0 * Math.cos(start.omega);
  params[5] = start.m0 + start.omega;
  const toEl = (p: Float64Array): Elements => {
    const el = { ...start };
    FIT_KEYS.forEach((key, i) => (el[key] = p[i] as number));
    const h = p[1] as number;
    const k = p[4] as number;
    el.e = Math.hypot(h, k);
    el.omega = Math.atan2(h, k);
    el.m0 = (p[5] as number) - el.omega;
    return el;
  };
  const cost = (p: Float64Array): number => {
    const el = toEl(p);
    let s = 0;
    for (let j = 0; j < m; j++) {
      keplerPosition(el, tk[j] as number, c, pos);
      const dx = (obs[3 * j] as number) - (pos[0] as number);
      const dy = (obs[3 * j + 1] as number) - (pos[1] as number);
      const dz = (obs[3 * j + 2] as number) - (pos[2] as number);
      s += dx * dx + dy * dy + dz * dz;
    }
    return s;
  };
  let current = cost(params);
  let lambda = 1e-6;
  let iterations = 0;
  const trial = new Float64Array(NP);
  const scale = new Float64Array(NP);
  const delta = new Float64Array(NP);
  while (iterations < maxIter) {
    iterations += 1;
    N.fill(0);
    b.fill(0);
    const el = toEl(params);
    const e = Math.max(el.e, 1e-12);
    const h = (params[1] as number) / e;
    const k = (params[4] as number) / e;
    for (let j = 0; j < m; j++) {
      keplerPosition(el, tk[j] as number, c, pos, jac);
      // Chain rule from (e, omega, M0) to (h, k, L); (J_omega - J_M) is O(e), so dividing by e stays finite.
      for (let ax = 0; ax < 3; ax++) {
        const Je = jac[3 + ax] as number;
        const Jw = jac[12 + ax] as number;
        const JM = jac[15 + ax] as number;
        const d = (Jw - JM) / e;
        jac[3 + ax] = Je * h + d * k;
        jac[12 + ax] = Je * k - d * h;
      }
      for (let ax = 0; ax < 3; ax++) {
        const res = (obs[3 * j + ax] as number) - (pos[ax] as number);
        for (let p = 0; p < NP; p++) {
          const jp = jac[3 * p + ax] as number;
          b[p] = (b[p] as number) + jp * res;
          for (let q = p; q < NP; q++) N[p * NP + q] = (N[p * NP + q] as number) + jp * (jac[3 * q + ax] as number);
        }
      }
    }
    for (let p = 0; p < NP; p++) {
      for (let q = 0; q < p; q++) N[p * NP + q] = N[q * NP + p] as number;
      scale[p] = Math.sqrt(N[p * NP + p] as number) || 1;
    }
    let accepted = false;
    let converged = false;
    for (let attempt = 0; attempt < 10 && !accepted; attempt++) {
      if (!solveScaled(N, b, scale, lambda, delta)) return null;
      for (let p = 0; p < NP; p++) trial[p] = (params[p] as number) + (delta[p] as number);
      const next = cost(trial);
      if (Number.isFinite(next) && next <= current) {
        converged = lambda <= 1e-3 && (current - next) / Math.max(current, 1e-30) < 1e-3;
        params.set(trial);
        current = next;
        lambda = Math.max(lambda / 10, 1e-12);
        accepted = true;
      } else {
        lambda *= 10;
      }
    }
    if (!accepted || converged) break;
  }
  const el = toEl(params);
  if (!(el.sqrtA > 0) || !(el.e < 1) || !Number.isFinite(current)) return null;
  return { el, rms: Math.sqrt(current / m), iterations };
}

/** Solves (S^-1 N S^-1 + lambda I) y = S^-1 b, x = S^-1 y by Cholesky; false when the matrix is not positive definite. */
function solveScaled(N: Float64Array, b: Float64Array, s: Float64Array, lambda: number, x: Float64Array): boolean {
  const n = b.length;
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = (N[i * n + j] as number) / ((s[i] as number) * (s[j] as number)) + (i === j ? lambda : 0);
      for (let k = 0; k < j; k++) sum -= (L[i * n + k] as number) * (L[j * n + k] as number);
      if (i === j) {
        if (!(sum > 0)) return false;
        L[i * n + i] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / (L[j * n + j] as number);
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = (b[i] as number) / (s[i] as number);
    for (let k = 0; k < i; k++) sum -= (L[i * n + k] as number) * (y[k] as number);
    y[i] = sum / (L[i * n + i] as number);
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i] as number;
    for (let k = i + 1; k < n; k++) sum -= (L[k * n + i] as number) * (y[k] as number);
    y[i] = sum / (L[i * n + i] as number);
  }
  for (let i = 0; i < n; i++) x[i] = (y[i] as number) / (s[i] as number);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// GLONASS

/** PZ-90 constants of the GLONASS ICD user algorithm (km, s). */
const GLO = { mu: 398600.4418, ae: 6378.136, j2: 1082625.75e-9, omegaE: 7.292115e-5 };

/** Right-hand side of the ICD equations in ECEF (km, km/s), with the constant luni-solar acceleration `acc` [km/s^2]. */
function gloDerivative(s: Float64Array, acc: Float64Array, out: Float64Array): void {
  const x = s[0] as number;
  const y = s[1] as number;
  const z = s[2] as number;
  const vx = s[3] as number;
  const vy = s[4] as number;
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2);
  const muR3 = GLO.mu / (r2 * r);
  const k = (1.5 * GLO.j2 * GLO.mu * GLO.ae * GLO.ae) / (r2 * r2 * r);
  const z2r2 = (5 * z * z) / r2;
  const w2 = GLO.omegaE * GLO.omegaE;
  out[0] = vx;
  out[1] = vy;
  out[2] = s[5] as number;
  out[3] = -muR3 * x - k * x * (1 - z2r2) + w2 * x + 2 * GLO.omegaE * vy + (acc[0] as number);
  out[4] = -muR3 * y - k * y * (1 - z2r2) + w2 * y - 2 * GLO.omegaE * vx + (acc[1] as number);
  out[5] = -muR3 * z - k * z * (3 - z2r2) + (acc[2] as number);
}

/**
 * The GLONASS ICD propagation (A.3.1.2): Runge-Kutta 4 from the state `s0` (x, y, z km, vx, vy, vz km/s, ECEF) over `dt` seconds with steps
 * of at most 60 s; returns the ECEF position in metres.
 */
export function glonassPropagate(s0: Float64Array, acc: Float64Array, dt: number, out: Float64Array): void {
  const steps = Math.max(1, Math.ceil(Math.abs(dt) / 60));
  const h = dt / steps;
  const s = Float64Array.from(s0);
  const k1 = new Float64Array(6);
  const k2 = new Float64Array(6);
  const k3 = new Float64Array(6);
  const k4 = new Float64Array(6);
  const tmp = new Float64Array(6);
  for (let i = 0; i < steps; i++) {
    gloDerivative(s, acc, k1);
    for (let j = 0; j < 6; j++) tmp[j] = (s[j] as number) + (h / 2) * (k1[j] as number);
    gloDerivative(tmp, acc, k2);
    for (let j = 0; j < 6; j++) tmp[j] = (s[j] as number) + (h / 2) * (k2[j] as number);
    gloDerivative(tmp, acc, k3);
    for (let j = 0; j < 6; j++) tmp[j] = (s[j] as number) + h * (k3[j] as number);
    gloDerivative(tmp, acc, k4);
    for (let j = 0; j < 6; j++) s[j] = (s[j] as number) + (h / 6) * ((k1[j] as number) + 2 * (k2[j] as number) + 2 * (k3[j] as number) + (k4[j] as number));
  }
  out[0] = (s[0] as number) * 1000;
  out[1] = (s[1] as number) * 1000;
  out[2] = (s[2] as number) * 1000;
}

const GM_SUN = 1.32712440018e11; // km^3/s^2
const GM_MOON = 4902.800066;
const DEG = Math.PI / 180;

/** Sun and Moon positions [km], mean equator and equinox of date (low precision, about 0.1 degree), at a GPS time. */
export function sunMoon(gps: number): { sun: [number, number, number]; moon: [number, number, number] } {
  // Julian centuries of TT (GPS + 51.184 s) since J2000; the GPS epoch is JD 2444244.5.
  const T = ((gps + 51.184) / 86400 + 2444244.5 - 2451545.0) / 36525;
  const eps = 23.43929111 * DEG;
  // Sun (M&G eq. 3.43 to 3.45), the +1.3972 T term moves the J2000 longitude to the equinox of date.
  const Ms = (357.5256 + 35999.049 * T) * DEG;
  const lonSun = (282.94 + 1.3972 * T) * DEG + Ms + (6892 / 3600) * DEG * Math.sin(Ms) + (72 / 3600) * DEG * Math.sin(2 * Ms);
  const rSun = (149.619 - 2.499 * Math.cos(Ms) - 0.021 * Math.cos(2 * Ms)) * 1e6;
  const sunEcl = [rSun * Math.cos(lonSun), rSun * Math.sin(lonSun), 0] as const;
  // Moon (M&G eq. 3.46 to 3.48), equinox of date (without their -1.3972 T).
  const L0 = 218.31617 + 481267.88088 * T;
  const l = (134.96292 + 477198.86753 * T) * DEG;
  const lp = (357.52543 + 35999.04944 * T) * DEG;
  const F = (93.27283 + 483202.01873 * T) * DEG;
  const D = (297.85027 + 445267.11135 * T) * DEG;
  const lonMoon =
    (L0 +
      (22640 * Math.sin(l) + 769 * Math.sin(2 * l) - 4586 * Math.sin(l - 2 * D) + 2370 * Math.sin(2 * D) - 668 * Math.sin(lp) - 412 * Math.sin(2 * F) -
        212 * Math.sin(2 * l - 2 * D) - 206 * Math.sin(l + lp - 2 * D) + 192 * Math.sin(l + 2 * D) - 165 * Math.sin(lp - 2 * D) + 148 * Math.sin(l - lp) -
        125 * Math.sin(D) - 110 * Math.sin(l + lp) - 55 * Math.sin(2 * F - 2 * D)) /
        3600) *
    DEG;
  const latMoon =
    ((18520 * Math.sin(F + lonMoon - L0 * DEG + (412 * Math.sin(2 * F) + 541 * Math.sin(lp)) / 3600 * DEG) - 526 * Math.sin(F - 2 * D)) / 3600) * DEG;
  const rMoon = 385000 - 20905 * Math.cos(l) - 3699 * Math.cos(2 * D - l) - 2956 * Math.cos(2 * D) - 570 * Math.cos(2 * l) + 246 * Math.cos(2 * l - 2 * D) -
    205 * Math.cos(lp - 2 * D) - 171 * Math.cos(l + 2 * D) - 152 * Math.cos(l + lp - 2 * D);
  const moonEcl = [rMoon * Math.cos(latMoon) * Math.cos(lonMoon), rMoon * Math.cos(latMoon) * Math.sin(lonMoon), rMoon * Math.sin(latMoon)] as const;
  const toEq = (v: readonly [number, number, number]): [number, number, number] => [
    v[0],
    v[1] * Math.cos(eps) - v[2] * Math.sin(eps),
    v[1] * Math.sin(eps) + v[2] * Math.cos(eps),
  ];
  return { sun: toEq(sunEcl), moon: toEq(moonEcl) };
}

/** Greenwich mean sidereal angle [rad] at a GPS time (UT1 taken as UTC = GPS - leap). */
export function gmst(gps: number, leap: number): number {
  const jdUt = (gps - leap) / 86400 + 2444244.5;
  const d = jdUt - 2451545.0;
  const deg = 280.46061837 + 360.98564736629 * d;
  return ((deg % 360) + 360) % 360 * DEG;
}

/**
 * Luni-solar acceleration [km/s^2] on a satellite at ECEF `posKm`, in ECEF axes, at a GPS time: what the GLONASS message carries as
 * x'', y'', z'' (ICD 4.4: projections of the accelerations due to Moon and Sun on the PZ-90 axes, constant over the interval).
 */
export function lunisolarAcceleration(posKm: Float64Array, gps: number, leap: number, out: Float64Array): void {
  const th = gmst(gps, leap);
  const c = Math.cos(th);
  const s = Math.sin(th);
  // ECEF -> inertial of date: rotate by +theta about z.
  const x = (posKm[0] as number) * c - (posKm[1] as number) * s;
  const y = (posKm[0] as number) * s + (posKm[1] as number) * c;
  const z = posKm[2] as number;
  const { sun, moon } = sunMoon(gps);
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (const [b, gm] of [
    [sun, GM_SUN],
    [moon, GM_MOON],
  ] as const) {
    const dx = b[0] - x;
    const dy = b[1] - y;
    const dz = b[2] - z;
    const d3 = Math.hypot(dx, dy, dz) ** 3;
    const r3 = Math.hypot(b[0], b[1], b[2]) ** 3;
    ax += gm * (dx / d3 - b[0] / r3);
    ay += gm * (dy / d3 - b[1] / r3);
    az += gm * (dz / d3 - b[2] / r3);
  }
  // Inertial -> ECEF: rotate by -theta.
  out[0] = ax * c + ay * s;
  out[1] = -ax * s + ay * c;
  out[2] = az;
}
