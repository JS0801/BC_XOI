/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/search', 'N/record', 'N/log'],
function(runtime, search, record, log) {

    var SEARCH_PARAM_ID = 'custscript_search_id';

    function afterSubmit(context) {
        try {
            var newRec = context.newRecord;
            var oldRec = context.oldRecord;
            var eventType = context.type;

            if (eventType !== context.UserEventType.EDIT) return;

            var taskId = newRec.id;
            log.debug('afterSubmit', 'Type: ' + eventType + ', Task: ' + taskId)
            
            // Get search ID from parameter
            var scriptObj = runtime.getCurrentScript();
            var searchId = scriptObj.getParameter({ name: SEARCH_PARAM_ID });

            if (!searchId) {
                log.error('Missing search ID',
                          'Setup script parameter ' + SEARCH_PARAM_ID + ' with your task search ID.');
                return;
            }

            var taskSearch;
            try {
                taskSearch = search.load({ id: searchId });
            } catch (e) {
                log.error('Search load failed', 'ID: ' + searchId + ' Error: ' + e.message);
                return;
            }


          var filters = taskSearch.filters || [];
                filters.push(search.createFilter({
                    name: 'internalid',
                    operator: search.Operator.ANYOF,
                    values: taskId
                }));
                taskSearch.filters = filters;

            var cols = taskSearch.columns || [];
            var changed = false;

            for (var i = 0; i < cols.length; i++) {
                var col = cols[i];
                var fieldId = col.name;

                // Ignore internalid or empty
                if (!fieldId || fieldId === 'internalid') {
                    continue;
                }

                var oldVal = normalizeValue(oldRec.getValue({ fieldId: fieldId }));
                var newVal = normalizeValue(newRec.getValue({ fieldId: fieldId }));

                if (oldVal !== newVal) {
                    changed = true;
                    log.debug('Field changed',
                        fieldId + ' | old: ' + oldVal + ' | new: ' + newVal);
                    break; // no need to check more
                }
            }

            if (changed) {
                markSendFlag(taskId);
            } else {
                log.debug('No changes in watched fields', 'Flag not updated');
            }

        } catch (e) {
            log.error('afterSubmit error', e);
        }
    }

      function normalizeValue(val) {
        if (val === null || val === undefined) {
            return '';
        }
        return String(val);
    }

    function markSendFlag(taskId) {
        try {
            record.submitFields({
                type: record.Type.TASK,
                id: taskId,
                values: {custevent_send_to_xoi: true}
            });

        } catch (e) {
            log.error('markSendFlag error', e);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
