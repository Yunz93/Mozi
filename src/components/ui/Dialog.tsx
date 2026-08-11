import React, { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppStore, defaultSettings } from "../../store/appStore";
import { getResolvedUiFontFamily } from "../../utils/fontSettings";
import { useI18n } from "../../hooks/useI18n";
import { useImeCompositionGate } from "../../hooks/useImeCompositionGate";
import { isPlainEnterKey } from "../../utils/imeKeyboard";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  contentScroll?: boolean;
}

/**
 * Custom Dialog component using React Portal
 */
export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
  className = "",
  contentClassName = "",
  contentScroll = true,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const settings = useAppStore((state) => state.settings);
  const uiFontScale = settings.uiFontSize / defaultSettings.uiFontSize;
  const uiFontFamily = getResolvedUiFontFamily(settings);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    // Store the previously focused element
    previousActiveElement.current = document.activeElement as HTMLElement;

    // Focus the dialog
    requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Restore focus on close
  useEffect(() => {
    if (!isOpen && previousActiveElement.current) {
      previousActiveElement.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // Handle click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  const content = (
    <div
      className="ui-scaled fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={
        {
          "--ui-font-size": `${settings.uiFontSize}px`,
          "--ui-font-scale": `${uiFontScale}`,
          fontFamily: uiFontFamily,
        } as React.CSSProperties
      }
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className={`
          relative flex w-full flex-col overflow-hidden rounded-2xl
          border border-gray-200/50 bg-white/95 shadow-2xl backdrop-blur-xl
          dark:border-white/10 dark:bg-gray-900/95
          max-h-[88vh]
          animate-scale-in
          focus:outline-none
          ${className}
        `}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "dialog-title" : undefined}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between border-b border-gray-200/50 px-6 py-4 dark:border-white/10">
            <h2
              id="dialog-title"
              className="text-lg font-bold text-gray-900 dark:text-white"
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
              aria-label="Close dialog"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div
          className={`min-h-0 flex-1 ${contentScroll ? "overflow-y-auto" : "overflow-visible"} px-6 py-4 ${contentClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );

  // Use portal to render at document root
  return createPortal(content, document.body);
};

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
}

/**
 * Confirmation dialog component
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = "info",
}) => {
  const { t } = useI18n();
  const resolvedConfirmText = confirmText ?? t("common_confirm");
  const resolvedCancelText = cancelText ?? t("common_cancel");
  const handleConfirm = useCallback(() => {
    onConfirm();
    onClose();
  }, [onConfirm, onClose]);

  const variantStyles = {
    danger: "bg-red-500 hover:bg-red-600 text-white",
    warning: "bg-yellow-500 hover:bg-yellow-600 text-white",
    info: "bg-black hover:bg-gray-800 text-white dark:bg-white dark:hover:bg-gray-100 dark:text-black",
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="max-w-md"
    >
      <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          {resolvedCancelText}
        </button>
        <button
          onClick={handleConfirm}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${variantStyles[variant]}`}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {resolvedConfirmText}
        </button>
      </div>
    </Dialog>
  );
};

interface PromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  submitText?: string;
  cancelText?: string;
}

/**
 * Input prompt dialog component
 */
export const PromptDialog: React.FC<PromptDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  label,
  placeholder = "",
  defaultValue = "",
  submitText,
  cancelText,
}) => {
  const { t } = useI18n();
  const resolvedSubmitText = submitText ?? t("common_confirm");
  const resolvedCancelText = cancelText ?? t("common_cancel");
  const [value, setValue] = React.useState(defaultValue);
  const [hasSubmitted, setHasSubmitted] = React.useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const {
    isComposing: isImeComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useImeCompositionGate();

  // Reset value when dialog opens
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setHasSubmitted(false);
      submittedRef.current = false;
      // Focus input after dialog opens
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isOpen, defaultValue]);

  const handleSubmit = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setHasSubmitted(true);
    onSubmit(value);
    onClose();
  }, [value, onSubmit, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME candidate confirm (Enter) must not submit an incomplete filename.
      if (isImeComposing(e) || !isPlainEnterKey(e)) return;
      e.preventDefault();
      handleSubmit();
    },
    [handleSubmit, isImeComposing],
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="max-w-md"
    >
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
      />
      <div className="flex justify-end gap-3 mt-4">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          {resolvedCancelText}
        </button>
        <button
          onClick={handleSubmit}
          disabled={hasSubmitted}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-black dark:bg-white dark:text-black rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:pointer-events-none"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {resolvedSubmitText}
        </button>
      </div>
    </Dialog>
  );
};
