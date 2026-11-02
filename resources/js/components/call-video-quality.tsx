import type { CallVideoQuality } from '@/lib/call-media';
import * as Dialog from '@radix-ui/react-dialog';
import type { RefObject } from 'react';

export function CallVideoQualitySelect({
    value,
    disabled,
    onChange,
}: {
    value: CallVideoQuality;
    disabled?: boolean;
    onChange: (quality: CallVideoQuality) => void;
}) {
    return (
        <label className="relay-call-setting">
            Video quality
            <select
                value={value}
                disabled={disabled}
                onChange={(event) =>
                    onChange(
                        event.target.value === 'high' ? 'high' : 'performance',
                    )
                }
            >
                <option value="performance">Performance · 360p</option>
                <option value="high">High quality · 1080p</option>
            </select>
        </label>
    );
}

export function CallVideoStartDialog({
    open,
    quality,
    disabled,
    onQualityChange,
    onOpenChange,
    onStart,
    returnFocusRef,
}: {
    open: boolean;
    quality: CallVideoQuality;
    disabled: boolean;
    onQualityChange: (quality: CallVideoQuality) => void;
    onOpenChange: (open: boolean) => void;
    onStart: () => void;
    returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Overlay className="relay-overlay">
                <Dialog.Content
                    className="relay-call relay-call-choice"
                    onCloseAutoFocus={(event) => {
                        if (returnFocusRef?.current) {
                            event.preventDefault();
                            returnFocusRef.current.focus();
                        }
                    }}
                >
                    <Dialog.Title>Start video call</Dialog.Title>
                    <Dialog.Description>
                        Choose the quality of the video you send. You can change
                        it during the call.
                    </Dialog.Description>
                    <CallVideoQualitySelect
                        value={quality}
                        disabled={disabled}
                        onChange={onQualityChange}
                    />
                    <p className="relay-call-setting-note">
                        Performance uses less data and processing. High quality
                        requests 1080p and uses more data; your camera and
                        connection determine the result.
                    </p>
                    <div className="relay-call-controls">
                        <Dialog.Close asChild>
                            <button type="button" className="relay-secondary">
                                Cancel
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            className="relay-primary"
                            disabled={disabled}
                            onClick={onStart}
                        >
                            Start call
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Overlay>
        </Dialog.Root>
    );
}
