import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    canApplyAnswer,
    RemoteDescriptions,
} from '../resources/js/lib/call-negotiation.ts';

test('a different or late answer cannot be applied after negotiation completed', () => {
    assert.equal(canApplyAnswer('have-local-offer'), true);
    for (const state of ['stable', 'closed', 'have-remote-offer'])
        assert.equal(canApplyAnswer(state), false);
});

const offer = {
    type: 'offer',
    sdp: 'v=0\r\no=- 100 2 IN IP4 127.0.0.1\r\na=ice-ufrag:abc\r\n',
};
const answer = { ...offer, type: 'answer' };

test('a retried answer after trickled ICE is not applied in stable signaling state', () => {
    const descriptions = new RemoteDescriptions();
    let state = 'have-local-offer';
    let applied = 0;
    const apply = (description) => {
        if (descriptions.classify(description) !== 'new') return;
        assert.equal(
            state,
            'have-local-offer',
            'A second answer would fail in native WebRTC',
        );
        state = 'stable';
        applied++;
        descriptions.remember(description);
    };
    apply(answer);
    apply({
        ...answer,
        sdp:
            answer.sdp +
            'a=candidate:1 1 udp 1 192.0.2.1 1234 typ host\r\na=end-of-candidates\r\n',
    });
    assert.equal(applied, 1);
});

test('repeated offers can resend the answer despite additional embedded ICE', () => {
    const descriptions = new RemoteDescriptions();
    descriptions.remember(offer);
    assert.equal(
        descriptions.classify({
            ...offer,
            sdp: offer.sdp + 'a=candidate:new\r\n',
        }),
        'repeat',
    );
});

test('an ICE restart remains a new negotiation; older offers stay stale', () => {
    const descriptions = new RemoteDescriptions();
    descriptions.remember(offer);
    const restart = {
        ...offer,
        sdp: offer.sdp
            .replace('100 2', '100 3')
            .replace('ufrag:abc', 'ufrag:xyz'),
    };
    assert.equal(descriptions.classify(restart), 'new');
    descriptions.remember(restart);
    assert.equal(descriptions.classify(offer), 'stale');
    descriptions.clear();
    assert.equal(descriptions.classify(offer), 'new');
});
