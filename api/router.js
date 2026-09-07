import { getMotor, listMotors, INGESTION_MOTORS } from '../lib/motors/index.js';

export { INGESTION_MOTORS } from '../lib/motors/index.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required' });
  try {
    const tenantName = req.body?.tenant;
    if (tenantName !== 'data_loader') return res.status(403).json({ ok: false, error: tenantName ? 'Tenant not allowed' : 'tenant is required' });

    const motorName = req.body?.motor;
    if (typeof motorName !== 'string' || !motorName) return res.status(400).json({ ok: false, error: 'motor is required' });
    if (!INGESTION_MOTORS.includes(motorName)) return res.status(403).json({ ok: false, error: 'Motor not allowed for tenant', allowedMotors: INGESTION_MOTORS });

    const motor = getMotor(motorName);
    if (!motor) return res.status(400).json({ ok: false, error: 'Unknown motor', allowedMotors: listMotors() });

    const result = await motor(req.body?.input ?? {});
    return res.status(200).json({ ok: true, tenant: tenantName, motor: motorName, ...result });
  } catch (error) {
    console.error(error);
    return res.status(error?.code ? 400 : 500).json({ ok: false, error: error.message, ...(error?.code ? { error_code: error.code } : {}) });
  }
}
