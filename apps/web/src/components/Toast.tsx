import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';

const LOOKS_WRONG = /失败|无法|错误|请先/;

/** Status is an event, not a label: it arrives, stays long enough to read, and leaves. */
export function Toast() {
  const message = useStore((state) => state.message);
  const ready = useStore((state) => state.ready);
  const [visible, setVisible] = useState(false);
  const seen = useRef(false);
  useEffect(() => {
    if (!message || !ready) return;
    if (!seen.current) { seen.current = true; return; } // The boot message restates what is on screen.
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), LOOKS_WRONG.test(message) ? 6400 : 3200);
    return () => clearTimeout(timer);
  }, [message, ready]);
  const wrong = LOOKS_WRONG.test(message);
  return <div className="toast" data-visible={visible} data-tone={wrong ? 'error' : 'ok'} role="status">
    {visible && <><Icon name={wrong ? 'alert' : 'check'} size={16} /><span>{message}</span></>}
  </div>;
}
