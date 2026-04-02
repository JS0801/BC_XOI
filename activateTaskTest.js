/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */
define(['N/runtime', 'N/log', 'N/record'],
function (runtime, log, record) {

    function execute() {

        var script = runtime.getCurrentScript();

        var caseId = script.getParameter({
            name: 'custscript_case_id'
        });

        if (!caseId) {
            log.error('Missing caseId');
            return;
        }

        record.submitFields({
            type: record.Type.SUPPORT_CASE,
            id: caseId,
            values: {
                isinactive: false
            }
        });

        log.audit('Case Reactivated', { caseId: caseId });
    }

    return { execute: execute };
});
