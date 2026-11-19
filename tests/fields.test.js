import {test} from 'node:test';
import assert from 'node:assert/strict';

import {gitlabFieldRequests, gitlabFieldsRequest, parseGitLabFields} from '../src/lib/gitlabModel.js';
import {
    boardFieldsRequest,
    fieldChange,
    fieldEditProblem,
    githubFieldRequests,
    issueFieldsRequest,
    parseBoardFields,
    parseIssueFields,
} from '../src/lib/model.js';
import {fieldRequests, fieldsRequests} from '../src/lib/requests.js';

const issue = {kind: 'issue', repo: 'octo/app', number: 12, nodeId: 'I_12'};
const pr = {kind: 'pr', repo: 'octo/app', number: 7, nodeId: 'PR_7'};
const draft = {kind: 'draft', repo: 'project', number: 'PVTI_1', draftId: 'DI_1'};
const gitlabIssue = {platform: 'gitlab', kind: 'issue', repo: 'group/web', number: 3};

const issueFieldsJson = {data: {repository: {
    issueFields: {nodes: [
        {id: 'IFSS_1', name: 'Priority', dataType: 'SINGLE_SELECT', options: [{id: 'O_hi', name: 'High'}, {id: 'O_lo', name: 'Low'}]},
        {id: 'IFD_1', name: 'Target date', dataType: 'DATE'},
        {id: 'IFN_1', name: 'Points', dataType: 'NUMBER'},
        {id: 'bad id!', name: 'Broken', dataType: 'TEXT'},
        {id: 'IFX_1', name: 'Odd', dataType: 'SOMETHING_NEW'},
    ]},
    issue: {id: 'I_12', issueFieldValues: {nodes: [
        {optionId: 'O_hi', field: {id: 'IFSS_1'}},
        {date: '2026-12-01', field: {id: 'IFD_1'}},
        {optionId: 'O_gone', field: {id: 'nope'}},
    ]}},
}}};

const boardJson = {data: {node: {projectItems: {nodes: [
    {id: 'PVTI_A', project: {id: 'PVT_A', title: 'Roadmap', closed: false,
        fields: {nodes: [
            {id: 'F_status', name: 'Status', dataType: 'SINGLE_SELECT', options: [{id: 's1', name: 'Todo'}]},
            {id: 'F_title', name: 'Title', dataType: 'TITLE'},
            {id: 'F_note', name: 'Note', dataType: 'TEXT'},
            {id: 'F_size', name: 'Size', dataType: 'NUMBER'},
            {id: 'F_sprint', name: 'Sprint', dataType: 'ITERATION', configuration: {iterations: [{id: 'it1', title: 'Sprint 1'}]}},
            {id: 'F_tags', name: 'Tags', dataType: 'MULTI_SELECT', multiSelectOptions: [{id: 't1', name: 'ux'}, {id: 't2', name: 'api'}]},
            {id: 'F_mirror', name: 'Priority', dataType: 'MULTI_SELECT', isIssueField: true, multiSelectOptions: []},
        ]}},
    fieldValues: {nodes: [
        {optionId: 's1', field: {id: 'F_status'}},
        {text: 'ship it', field: {id: 'F_note'}},
        {number: 3, field: {id: 'F_size'}},
        {iterationId: 'it1', field: {id: 'F_sprint'}},
        {options: [{id: 't2'}, {id: 'zz'}], field: {id: 'F_tags'}},
        {},
    ]}},
    {id: 'PVTI_B', project: {id: 'PVT_B', title: 'Old', closed: true, fields: {nodes: [{id: 'F_x', name: 'X', dataType: 'TEXT'}]}}},
    {id: 'PVTI_C', project: {id: 'PVT_C', title: 'Plain', closed: false, fields: {nodes: [{id: 'F_s', name: 'Status', dataType: 'SINGLE_SELECT'}]}}},
]}}}};

test('issue and board field requests only go out for what has them', () => {
    const request = issueFieldsRequest(issue);
    assert.deepEqual(request.body.variables, {owner: 'octo', name: 'app', number: 12});
    assert.equal(request.features, 'issue_fields');
    assert.equal(request.partial, true);
    assert.equal(issueFieldsRequest(pr), null);
    assert.equal(issueFieldsRequest(gitlabIssue), null);
    assert.equal(issueFieldsRequest({...issue, repo: 'bad repo'}), null);
    assert.deepEqual(boardFieldsRequest(issue).body.variables, {id: 'I_12'});
    assert.deepEqual(boardFieldsRequest(draft).body.variables, {id: 'PVTI_1'});
    assert.equal(boardFieldsRequest({...pr, nodeId: null}), null);
    assert.equal(gitlabFieldsRequest(gitlabIssue).body.variables.iid, '3');
    assert.equal(gitlabFieldsRequest({...gitlabIssue, kind: 'pr'}), null);
    assert.equal(gitlabFieldsRequest({...gitlabIssue, repo: '../x'}), null);
});

test('parseIssueFields keeps editable fields with their values, dropping malformed ones', () => {
    const section = parseIssueFields(issueFieldsJson);
    assert.equal(section.kind, 'issue');
    assert.equal(section.issueId, 'I_12');
    assert.deepEqual(section.fields.map(field => [field.name, field.type, field.value, field.selected]),
        [['Priority', 'single', '', ['O_hi']], ['Target date', 'date', '2026-12-01', []], ['Points', 'number', '', []]]);
    assert.equal(parseIssueFields({data: {repository: {issueFields: {nodes: []}, issue: {id: 'I_12'}}}}), null);
    assert.equal(parseIssueFields(null), null);
});

test('parseBoardFields: one section per open board, without Status, built-ins or mirrored issue fields', () => {
    const sections = parseBoardFields(boardJson);
    assert.equal(sections.length, 1);
    const [board] = sections;
    assert.deepEqual([board.kind, board.title, board.projectId, board.itemId], ['board', 'Roadmap', 'PVT_A', 'PVTI_A']);
    assert.deepEqual(board.fields.map(field => [field.name, field.type, field.value, field.selected]), [
        ['Note', 'text', 'ship it', []],
        ['Size', 'number', '3', []],
        ['Sprint', 'iteration', '', ['it1']],
        ['Tags', 'multi', '', ['t2']],
    ]);
    // A draft's board item comes back as the node itself.
    const draftSections = parseBoardFields({data: {node: boardJson.data.node.projectItems.nodes[0]}});
    assert.equal(draftSections[0].itemId, 'PVTI_A');
    assert.deepEqual(parseBoardFields({data: {node: null}}), []);
});

test('fieldEditProblem and fieldChange check values and report only what changed', () => {
    const [note, size] = parseBoardFields(boardJson)[0].fields;
    const date = parseIssueFields(issueFieldsJson).fields[1];
    assert.equal(fieldEditProblem(size, {value: 'abc'}), 'number');
    assert.equal(fieldEditProblem(size, {value: ' 4.5 '}), null);
    assert.equal(fieldEditProblem(date, {value: '2026-13-45'}), 'date');
    assert.equal(fieldEditProblem(date, {value: ''}), null);
    assert.equal(fieldChange(note, {value: 'ship it'}), null);
    assert.deepEqual(fieldChange(note, {value: ''}), {clear: true});
    assert.deepEqual(fieldChange(size, {value: '4.5'}), {value: 4.5});
    assert.throws(() => fieldChange(size, {value: 'x'}), TypeError);
    const tags = parseBoardFields(boardJson)[0].fields[3];
    assert.equal(fieldChange(tags, {selected: ['t2']}), null);
    assert.deepEqual(fieldChange(tags, {selected: ['t1', 't2']}), {value: ['t1', 't2']});
    assert.deepEqual(fieldChange(tags, {selected: []}), {clear: true});
    assert.throws(() => fieldChange(tags, {selected: ['not-an-option']}), TypeError);
});

test('githubFieldRequests: one issue-fields mutation first, then a request per changed board field', () => {
    const issueSection = parseIssueFields(issueFieldsJson);
    const board = parseBoardFields(boardJson)[0];
    const [priority, target] = issueSection.fields;
    const [note, size, sprint] = board.fields;
    const requests = githubFieldRequests([
        {section: board, field: note, value: ''},
        {section: board, field: size, value: '8'},
        {section: board, field: sprint, selected: ['it1']},
        {section: issueSection, field: priority, selected: ['O_lo']},
        {section: issueSection, field: target, value: ''},
    ]);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].features, 'issue_fields');
    assert.deepEqual(requests[0].body.variables, {issue: 'I_12', fields: [
        {fieldId: 'IFSS_1', singleSelectOptionId: 'O_lo'}, {fieldId: 'IFD_1', delete: true}]});
    assert.match(requests[1].body.query, /clearProjectV2ItemFieldValue/);
    assert.deepEqual(requests[1].body.variables, {project: 'PVT_A', item: 'PVTI_A', field: 'F_note'});
    assert.match(requests[2].body.query, /updateProjectV2ItemFieldValue/);
    assert.deepEqual(requests[2].body.variables.value, {number: 8});
    assert.deepEqual(githubFieldRequests([{section: board, field: note, value: 'ship it'}]), []);
});

const gitlabJson = {data: {namespace: {workItem: {id: 'gid://gitlab/WorkItem/9', widgets: [{}, {customFieldValues: [
    {customField: {id: 'gid://gitlab/Issuables::CustomField/1', name: 'Team', fieldType: 'MULTI_SELECT',
        selectOptions: [{id: 'gid://gitlab/Issuables::CustomFieldSelectOption/5', value: 'Web'},
            {id: 'gid://gitlab/Issuables::CustomFieldSelectOption/6', value: 'API'}]},
    selectedOptions: [{id: 'gid://gitlab/Issuables::CustomFieldSelectOption/6'}]},
    {customField: {id: 'gid://gitlab/Issuables::CustomField/2', name: 'Estimate', fieldType: 'NUMBER'}, number: 2},
    {customField: {id: 'gid://gitlab/Issuables::CustomField/3', name: 'Notes', fieldType: 'TEXT'}, text: null},
    {customField: {id: 'not a gid', name: 'Bad', fieldType: 'TEXT'}},
]}]}}}};

test('GitLab custom fields: parse the work item, then one update with only what changed', () => {
    const sections = parseGitLabFields(gitlabJson);
    assert.equal(sections.length, 1);
    const [section] = sections;
    assert.equal(section.workItemId, 'gid://gitlab/WorkItem/9');
    assert.deepEqual(section.fields.map(field => [field.name, field.type, field.value, field.selected.length]),
        [['Team', 'multi', '', 1], ['Estimate', 'number', '2', 0], ['Notes', 'text', '', 0]]);
    const [team, estimate, notes] = section.fields;
    const requests = gitlabFieldRequests([
        {section, field: team, selected: []},
        {section, field: estimate, value: '2'},
        {section, field: notes, value: 'hello'},
    ]);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.variables, {id: 'gid://gitlab/WorkItem/9', fields: [
        {customFieldId: 'gid://gitlab/Issuables::CustomField/1', selectedOptionIds: []},
        {customFieldId: 'gid://gitlab/Issuables::CustomField/3', textValue: 'hello'},
    ]});
    assert.deepEqual(parseGitLabFields({data: {namespace: {workItem: null}}}), []);
});

test('requests.js picks the platform and tolerates a source that failed', () => {
    const github = fieldsRequests(issue);
    assert.equal(github.requests.length, 2);
    assert.deepEqual(github.parse([null, boardJson]).map(section => section.kind), ['board']);
    assert.deepEqual(github.parse([issueFieldsJson, null]).map(section => section.kind), ['issue']);
    const forPr = fieldsRequests(pr);
    assert.equal(forPr.requests.length, 1);
    assert.equal(forPr.parse([boardJson]).length, 1);
    assert.equal(fieldsRequests({...gitlabIssue, kind: 'pr'}).requests.length, 0);
    assert.deepEqual(fieldsRequests({...gitlabIssue, kind: 'pr'}).parse([]), []);
    assert.equal(fieldsRequests(gitlabIssue).parse([gitlabJson]).length, 1);
    const [section] = parseGitLabFields(gitlabJson);
    assert.equal(fieldRequests(gitlabIssue, [{section, field: section.fields[1], value: '5'}]).length, 1);
});
