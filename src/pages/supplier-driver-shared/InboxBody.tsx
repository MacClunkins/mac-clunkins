import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { describeNotification, type InboxRole, type InboxRow } from './inbox';
import { t } from './t';

/** Unread count for a nav badge. Quietly returns 0 if it cannot be read. */
export function useUnreadCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => {
      try {
        void Promise.resolve(supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null))
          .then((r: { count?: number | null }) => { if (live) setN(r?.count ?? 0); })
          .catch(() => undefined);
      } catch { /* not available (for example in a test) */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, []);
  return n;
}

/** Everything sent to this person. Opening it marks it all read, but what was new stays highlighted while it is open. */
export function InboxBody({ role }: { role: InboxRole }) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState(false);
  const fresh = useRef<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await supabase.from('notifications').select('id, template, payload, created_at, read_at').order('created_at', { ascending: false }).limit(50);
      if (!live) return;
      if (r.error) return setError(true);
      const list = (r.data ?? []) as InboxRow[];
      fresh.current = new Set(list.filter((x) => x.read_at === null).map((x) => x.id));
      setRows(list);
      if (fresh.current.size > 0) void supabase.rpc('mark_notifications_read');
    })();
    return () => { live = false; };
  }, []);

  return (
    <>
      <h1 className="font-heading text-2xl font-bold">{t('inbox.title')}</h1>
      <p className="mt-1 font-body text-sm text-ink/60">{t('inbox.subtitle')}</p>
      {error && <p role="alert" className="mt-4 font-body text-sm text-chilli">{t('inbox.error')}</p>}
      {rows && rows.length === 0 && <p className="mt-6 font-body text-sm text-ink/60" data-testid="inbox-empty">{t('inbox.empty')}</p>}
      <ul className="mt-4 flex flex-col gap-2" data-testid="inbox-list">
        {(rows ?? []).map((n) => {
          const d = describeNotification(n, role);
          const isNew = fresh.current.has(n.id);
          const body = (
            <>
              <span className="block font-body text-sm">{d.text}</span>
              <span className="block font-body text-xs text-ink/60">{new Date(n.created_at).toLocaleString('en-ZA')}</span>
            </>
          );
          return (
            <li key={n.id} className={`rounded-2xl px-4 py-3 shadow-sm ${isNew ? 'bg-white ring-2 ring-chilli/40' : 'bg-white'}`} data-new={isNew ? 'true' : 'false'}>
              {d.to ? <Link to={d.to} className="block">{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </>
  );
}
