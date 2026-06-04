require('dotenv').config();
const cron = require('node-cron');
const { runReconciliation } = require('../services/reconciliationService');
const logger = require('../utils/logger');

const SCHEDULE = process.env.RECON_CRON_SCHEDULE || '0 2 * * *'; // 2:00 AM daily

const runNightlyReconciliation = async () => {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

  logger.info('Nightly reconciliation cron triggered', { periodStart, periodEnd });

  try {
    const report = await runReconciliation(periodStart.toISOString(), periodEnd.toISOString());

    if (report.status === 'has_discrepancies') {
      logger.error('RECONCILIATION ALERT — discrepancies found', {
        reportId: report.reportId,
        mismatches: report.mismatches,
        discrepancyAmt: report.discrepancyAmt,
      });
      // In production: send alert to PagerDuty / Slack / email
    } else {
      logger.info('Reconciliation clean — no discrepancies', { reportId: report.reportId });
    }
  } catch (err) {
    logger.error('Nightly reconciliation crashed', { error: err.message });
  }
};

// Run immediately on startup (useful for testing)
if (process.env.RUN_RECON_ON_START === 'true') {
  runNightlyReconciliation();
}

cron.schedule(SCHEDULE, runNightlyReconciliation, { timezone: 'Asia/Kolkata' });

logger.info('Reconciliation worker scheduled', { schedule: SCHEDULE });
