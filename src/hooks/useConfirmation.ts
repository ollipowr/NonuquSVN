import type { ConfirmDialogProps } from '@nonu/components';
import { useState } from 'react';

type Confirmation = Omit<ConfirmDialogProps, 'onCancel'> & {
  /** Runs on cancel, e.g. to settle a promise waiting for the answer. */
  onDismiss?: () => void;
};

/** Callback API: cancellation never leaves an unresolved promise behind. */
export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const cancel = () => {
    confirmation?.onDismiss?.();
    setConfirmation(null);
  };
  const show = (options: Confirmation) =>
    setConfirmation({
      ...options,
      onConfirm: () => {
        setConfirmation(null);
        options.onConfirm();
      },
      onExtra:
        options.onExtra &&
        (() => {
          setConfirmation(null);
          options.onExtra?.();
        }),
    });
  return { confirmation, show, cancel };
}
