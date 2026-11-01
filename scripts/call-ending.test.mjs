import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmCallEnd } from '../resources/js/lib/call-ending.ts';

test('successful hang-up needs one request', async () => {
    let requests = 0;
    await confirmCallEnd(async () => { requests++; }, () => false);
    assert.equal(requests, 1);
});

test('a lost hang-up response is retried automatically', async () => {
    let requests = 0;
    await confirmCallEnd(async () => {
        if (++requests === 1) throw new TypeError('Failed to fetch');
    }, () => false);
    assert.equal(requests, 2);
});

test('a server end event confirms hang-up even if its HTTP response times out', async () => {
    let confirmed = false;
    let requests = 0;
    await confirmCallEnd(async () => {
        requests++;
        confirmed = true;
        throw new DOMException('Request timed out', 'AbortError');
    }, () => confirmed);
    assert.equal(requests, 1);
});

test('already confirmed hang-ups do not send another request', async () => {
    await confirmCallEnd(async () => assert.fail('Unexpected request'), () => true);
});

test('persistent failures return an error after two attempts', async () => {
    let requests = 0;
    await assert.rejects(confirmCallEnd(async () => {
        requests++;
        throw Object.assign(new Error('Unavailable'), { status: 503 });
    }, () => false), /Unavailable/);
    assert.equal(requests, 2);
});

test('authentication failures are not retried', async () => {
    let requests = 0;
    await assert.rejects(confirmCallEnd(async () => {
        requests++;
        throw Object.assign(new Error('Unauthenticated'), { status: 401 });
    }, () => false), /Unauthenticated/);
    assert.equal(requests, 1);
});
