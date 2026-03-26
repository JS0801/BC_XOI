/** Original AM_XOI_Send_API_Calls_Webhook.js**/

//1/30/2026 


/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define([
    'N/search',
    'N/runtime',
    'N/https',
    'N/log',
    'N/record',
    './cryptojs','N/task','N/format'
], function (search, runtime, https, log, record, CryptoJS,task,format) {

     // ---- Script Parameters ----
    var PARAM_WEBHOOK_URL     = 'custscript_xoi_webhook_url';     // Text: XOi webhook URL
    var PARAM_HMAC_SECRET     = 'custscript_xoi_hmac_secret';     // Text/Password: shared secret string
    var PARAM_PAYLOAD_SEARCH  = 'custscriptxoi__payload_search';  // Text: Saved search ID for payload definition

    var SEND_FLAG_FIELD       = 'custevent_send_to_xoi';


    // XOi webhook version (per spec)
    var WEBHOOK_VERSION = '1';

    // ===================== getInputData =====================
    function getInputData() {
        log.debug('getInputData', 'Using inline task search.');
        return search.create({
            type: 'task',
            filters: [
                ['custevent_send_to_xoi', 'is', 'T']
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({
                    name: 'internalid',
                    join: 'case'
                })
            ]
        });
    }

    // ===================== map =====================
    function map(context) {
        try {
            var data   = JSON.parse(context.value);
            var values = data.values || {};
            var taskId = data.id;

            // Support Case ID from join: internalid.case
            var caseKey = 'internalid.case';
            var caseId;
            if (values[caseKey] && values[caseKey].value) {
                caseId = values[caseKey].value;
            }

            log.debug('map', 'Task ID: ' + taskId + ', Case ID: ' + caseId);
            
            if (caseId) {
                context.write({
                key: caseId,
                value: taskId   // value can be anything (or true)
                });
            }


            // Trigger XOi webhook with payload from saved search
            triggerXOi(taskId, caseId);

            // Clear flag so we don't send again
            clearSendFlag(taskId);

            log.debug({
                title:"Case id number",
                details:"caseid" + caseId
            })

            shouldRunForCase(caseId)//checks if case is made by api or not





        } catch (e) {
            log.error('map error', 'Key: ' + context.key + ' | ' + e.name + ' | ' + e.message);
        }
    }

    // We don't need reduce for this use case
    function reduce(context) {
    }

    function summarize(summary) {

        if (summary.inputSummary.error) {
            log.error('Input Error', summary.inputSummary.error);
        }

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('Map error for key: ' + key, error);
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('Reduce error for key: ' + key, error);
            return true;
        });

        //  MR execution id
        /*var mrTaskId = runtime.getCurrentScript().executionId;

        log.debug({
            details: mrTaskId + "taskId"
        })
        //  collect case ids written from map()
        var caseIds = [];
        summary.output.iterator().each(function (key, value) {
            caseIds.push(key); // key === caseId
            return true;
        });

        if (!caseIds.length) {
            log.debug('summarize', 'No caseIds found, skipping poller');
            return;
        }

        //  call ONCE
        var caseId = caseIds[0];*/
        
}


    // ===================== Helper: Build payload from saved search =====================
    /**
     * Uses a saved search (provided via parameter) to construct payload.
     * - The search columns' LABELs become JSON keys.
     * - The column values become JSON values.
     * - We always filter by current task internalid.
     */
    function buildPayloadFromSearch(taskId, caseId) {
        var scriptObj = runtime.getCurrentScript();
        var searchId  = scriptObj.getParameter({ name: PARAM_PAYLOAD_SEARCH });

        // Start with core fields so we keep original behavior
        var payload = {
            task_id: taskId,
            supportcase_id: caseId
        };

        if (!searchId) {
            log.error('buildPayloadFromSearch', 'Payload search parameter not set (' + PARAM_PAYLOAD_SEARCH + ')');
            return payload;
        }

        try {
            // Load the base search (structure only)
            var baseSearch = search.load({ id: searchId });

            // Re-create the search using the same columns but forcing filter on current task
            var payloadSearch = search.create({
                type: baseSearch.searchType,
                filters: [
                    ['internalid', 'anyof', taskId]
                ],
                columns: baseSearch.columns
            });

            var resultSet = payloadSearch.run().getRange({
                start: 0,
                end: 1
            });

            if (!resultSet || resultSet.length === 0) {
                log.error('buildPayloadFromSearch', 'No payload row found for task ' + taskId + ' using search ' + searchId);
                return payload;
            }

            var row    = resultSet[0];
            var cols   = payloadSearch.columns;
            var i;
            for (i = 0; i < cols.length; i++) {
                var col   = cols[i];
                var label = col.label; // we use label as JSON key

                if (!label) {
                    continue;
                }

                var value = row.getValue(col);
                if (value === null || value === '') {
                    continue;
                }

                // Convert "\n" sequences to real new lines anywhere they appear
                if (typeof value === 'string' && value.indexOf('\\n') !== -1) {
                    value = value.replace(/\\n/g, '\n');
                }
              
                payload[label] = value;
                
            }

        } catch (e) {
            log.error('buildPayloadFromSearch error',
                'Task: ' + taskId + ' | ' + e.name + ' | ' + e.message);
        }

        return payload;
    }

    // ===================== Helper: Trigger XOi =====================
    function triggerXOi(taskId, caseId) {
        var scriptObj = runtime.getCurrentScript();

        var url       = scriptObj.getParameter({ name: PARAM_WEBHOOK_URL });
        var secretStr = scriptObj.getParameter({ name: PARAM_HMAC_SECRET }); // same as webhookSecret in Postman

        if (!url) {
            log.error('triggerXOi', 'Webhook URL parameter not set (' + PARAM_WEBHOOK_URL + ')');
            return;
        }
        if (!secretStr) {
            log.error('triggerXOi', 'HMAC secret parameter not set (' + PARAM_HMAC_SECRET + ')');
            return;
        }

        // Build payload from saved search (label -> value)
        var payload = buildPayloadFromSearch(taskId, caseId);



        // Unix timestamp (seconds) as required by XOi
        var timestamp = Math.floor(new Date().getTime() / 1000);

        // Payload body (this is what we send as request body)
        var bodyStr = JSON.stringify(payload);

        // ===== Match Postman logic using CryptoJS =====
        // Convert body string to WordArray (UTF-8) and then to Base64
        var bodyWordArray = CryptoJS.enc.Utf8.parse(bodyStr);
        var bodyBase64    = CryptoJS.enc.Base64.stringify(bodyWordArray);

        // Build stringToSign: "<version>.<timestamp>.<base64(body)>"
        var stringToSign = WEBHOOK_VERSION + '.' + timestamp + '.' + bodyBase64;

        // Sign with HMAC-SHA256 using the shared secret and output Base64
        var signature = CryptoJS.HmacSHA256(stringToSign, secretStr)
            .toString(CryptoJS.enc.Base64);

        // ===== End signing logic =====

        log.debug('triggerXOi payload', bodyStr);
        log.debug('triggerXOi stringToSign', stringToSign);
        log.debug('triggerXOi signature', signature);

        var response = https.post({
            url: url,
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Version': WEBHOOK_VERSION,
                'X-Timestamp': String(timestamp),
                'X-Signature': signature
            },
            body: bodyStr
        });

        log.audit('XOi response',
            'Task: ' + taskId +
            ', Code: ' + response.code +
            ', Body: ' + response.body);

        //submitCaseReactivationPoller(caseId,taskId);
    }

    // ===================== Helper: Clear flag =====================
    function clearSendFlag(taskId) {
        if (!taskId) {
            return;
        }

        try {
            var values = {};
            values[SEND_FLAG_FIELD] = false;

            record.submitFields({
                type: record.Type.TASK,
                id: taskId,
                values: values
            });

        } catch (e) {
            log.error('clearSendFlag error',
                'Task: ' + taskId + ' | ' + e.name + ' | ' + e.message);
        }
    }

     // ===================== Makes case visible =====================



function submitCaseReactivationPoller(caseId) {
    try {
        // Submit Map/Reduce
        /*var mrTask = task.create({
            taskType: task.TaskType.MAP_REDUCE,
            scriptId: 'customscript_am_xoi_send_api_calls_webho',
            deploymentId: 'customdeploy_am_xoi_send_api_calls_webho'
        }); 

        var mrTaskId = mrTask.submit(); // unique MR execution id
        log.audit('MR Submitted', mrTaskId);
        */
        // Submit on-demand Scheduled Script and pass parameters
        log.debug({
            details:"caseid" + caseId // + " taskId" + taskId
        })
        var schedTask = task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT,
            scriptId: 'customscriptactivatetasktest',
            deploymentId: 'customdeploy3',
            params: {
                custscript_mr_task_id: null,
                custscript_case_id: caseId
            }
        });

        var schedTaskId = schedTask.submit();
        log.audit('Poller Scheduled', {
            scheduledTaskId: schedTaskId,
            caseId: caseId
        });

    } catch (e) {
        log.error('ERROR submitting poller', e.name + ': ' + e.message);
    }
}

  function shouldRunForCase(caseId) {
        caseId = caseId || null;
       var lifetimeMinutes= checkCaseLifetime(caseId)

        if (!caseId) {
            return;
        }

        log.debug({
            title:"Case lifetime",
            details:"Case lifetime: "+ lifetimeMinutes
        })

         if (lifetimeMinutes === null || lifetimeMinutes >= 60) {
            log.debug({
                title: 'Skipping case',
                details: 'Case lifetime >= 60 minutes'
            });
        return;
        }

        var result = search.lookupFields({
            type: search.Type.SUPPORT_CASE,
            id: caseId,
            columns: ['custeventcustevent_script_status']
        });

        var status = result.custeventcustevent_script_status;
        log.debug({
            title:"Is this an api call or not",
            details:status
        })
        if(status=="Api_Call"){
            log.debug({
                title:"execution:status",
                details:"Executed Successfully: Executing submitCaseReactivationPoller("+ caseId+")"
            })
            submitCaseReactivationPoller(caseId);
        }else{
            log.debug({
                details:"Api_call not found skipping reactivating case"
            })
        }   
    }



    function checkCaseLifetime(caseId) {

        if (!caseId) {
            log.error({
                title: 'Missing Case ID',
                details: 'No caseId passed'
            });
            return;
        }

        var result = search.lookupFields({ //result contains type,id,column
            type: search.Type.SUPPORT_CASE,
            id: caseId,
            columns: ['createddate']
        });

        if (!result.createddate) {
            log.error({
                title: 'Missing Created Date',
                details: 'Case has no createddate'
            });
            return;
        }

        //  Parse createddate using NetSuite timezone rules
        var createdDate = format.parse({
            value: result.createddate,
            type: format.Type.DATETIME 
        });

        //  Convert "now" into executing user's timezone
        var nowUserTz = format.parse({ //knows who is executing the script and bases values off of user's preference
            value: format.format({//sets up a time zone value specific to user executing the
                value: new Date(),
                type: format.Type.DATETIME
            }),
            type: format.Type.DATETIME
        });

        var lifetimeMs = nowUserTz - createdDate; //calculates the lifetime in milliseconds
        var lifetimeMinutes = lifetimeMs / (1000 * 60);//adjusts to minutes.

        log.debug({
            title: 'Case Lifetime Check',
            details: {
                caseId: caseId,
                created: createdDate,
                now: nowUserTz,
                lifetimeMinutes: lifetimeMinutes
            }
        });

        return lifetimeMinutes;
    }
    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});


   