type Description = { type: string; sdp: string };

/** Answers can only complete our outstanding local offer, never a stable peer. */
export function canApplyAnswer(signalingState: string) {
    return signalingState === 'have-local-offer';
}

// Trickle ICE changes the native SDP and retransmitted answers may embed more
// candidates. Neither represents a new offer/answer negotiation.
function key(description: Description) {
    const sdp = description.sdp
        .split(/\r?\n/)
        .filter(
            (line) =>
                !line.startsWith('a=candidate:') &&
                line !== 'a=end-of-candidates',
        )
        .join('\n');
    return `${description.type}:${sdp}`;
}

export class RemoteDescriptions {
    private seen = new Set<string>();
    private latest = '';

    classify(description: Description): 'new' | 'repeat' | 'stale' {
        const identity = key(description);
        if (!this.seen.has(identity)) return 'new';
        return identity === this.latest ? 'repeat' : 'stale';
    }

    remember(description: Description) {
        this.latest = key(description);
        this.seen.add(this.latest);
    }

    clear() {
        this.latest = '';
        this.seen.clear();
    }
}
