import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconX } from './icons';
import { FOCUSABLE_SELECTOR, lockScroll, unlockScroll } from './scrollLock';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
  className?: string;
  closeDisabled?: boolean;
}

const CLOSE_ANIMATION_DURATION = 350;

type OpenModalEntry = {
  id: symbol;
  elementRef: { current: HTMLDivElement | null };
  closeDisabledRef: { current: boolean };
  closeRef: { current: () => void };
};

const openModalStack: OpenModalEntry[] = [];
let isModalKeydownListenerAttached = false;

function removeOpenModal(id: symbol) {
  for (let index = openModalStack.length - 1; index >= 0; index -= 1) {
    if (openModalStack[index].id === id) openModalStack.splice(index, 1);
  }
}

function handleModalKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;

  // Effects may clean up after a portal has already left the DOM. Prune those stale entries so
  // a closing/unmounted modal can never consume the top position from a newly opened modal.
  while (openModalStack.length > 0) {
    const topModal = openModalStack[openModalStack.length - 1];
    if (topModal.elementRef.current?.isConnected) {
      if (topModal.closeDisabledRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      topModal.closeRef.current();
      return;
    }
    openModalStack.pop();
  }
}

function syncModalKeydownListener() {
  if (typeof window === 'undefined') return;
  if (openModalStack.length > 0 && !isModalKeydownListenerAttached) {
    window.addEventListener('keydown', handleModalKeyDown, true);
    isModalKeydownListenerAttached = true;
  } else if (openModalStack.length === 0 && isModalKeydownListenerAttached) {
    window.removeEventListener('keydown', handleModalKeyDown, true);
    isModalKeydownListenerAttached = false;
  }
}

export function Modal({
  open,
  title,
  onClose,
  footer,
  width = 520,
  className,
  closeDisabled = false,
  children,
}: PropsWithChildren<ModalProps>) {
  const { t } = useTranslation();
  const titleId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalStackIdRef = useRef(Symbol('modal'));
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeDisabledRef = useRef(closeDisabled);
  const closeRef = useRef<() => void>(() => undefined);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback(() => {
    if (!modalRef.current) return [] as HTMLElement[];
    return Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1
    );
  }, []);

  const startClose = useCallback(
    (notifyParent: boolean) => {
      if (closeTimerRef.current !== null) return;
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setIsClosing(false);
        closeTimerRef.current = null;
        if (notifyParent) {
          onClose();
        }
      }, CLOSE_ANIMATION_DURATION);
    },
    [onClose]
  );

  useEffect(() => {
    let cancelled = false;

    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      queueMicrotask(() => {
        if (cancelled) return;
        setIsVisible(true);
        setIsClosing(false);
      });
    } else if (isVisible) {
      queueMicrotask(() => {
        if (cancelled) return;
        startClose(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [open, isVisible, startClose]);

  const handleClose = useCallback(() => {
    startClose(true);
  }, [startClose]);

  closeDisabledRef.current = closeDisabled;
  closeRef.current = handleClose;

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const shouldLockScroll = open || isVisible;

  useEffect(() => {
    if (!shouldLockScroll) return;
    lockScroll();
    return () => unlockScroll();
  }, [shouldLockScroll]);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const firstFocusable = getFocusableElements()[0];
      (firstFocusable ?? closeButtonRef.current ?? modalRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [getFocusableElements, open]);

  useEffect(() => {
    if (open || isVisible) return;
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  }, [isVisible, open]);

  useEffect(() => {
    if (!open) return;

    const modalStackId = modalStackIdRef.current;
    removeOpenModal(modalStackId);
    openModalStack.push({
      id: modalStackId,
      elementRef: modalRef,
      closeDisabledRef,
      closeRef,
    });
    syncModalKeydownListener();

    return () => {
      removeOpenModal(modalStackId);
      syncModalKeydownListener();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        modalRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (activeElement === firstElement || activeElement === modalRef.current) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [getFocusableElements, open]);

  if (!open && !isVisible) return null;

  const overlayClass = `modal-overlay ${isClosing ? 'modal-overlay-closing' : 'modal-overlay-entering'}`;
  const modalClass = `modal ${isClosing ? 'modal-closing' : 'modal-entering'}${className ? ` ${className}` : ''}`;

  const modalContent = (
    <div className={overlayClass}>
      <div
        ref={modalRef}
        className={modalClass}
        style={{ width, maxWidth: '100%' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="modal-close-floating"
          onClick={closeDisabled ? undefined : handleClose}
          aria-label={t('common.close')}
          disabled={closeDisabled}
        >
          <IconX size={20} />
        </button>
        <div className="modal-header">
          <div className="modal-title" id={title ? titleId : undefined}>
            {title}
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}
