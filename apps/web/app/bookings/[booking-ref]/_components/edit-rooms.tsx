'use client';

import * as React from 'react';
import { Check, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GLASS_ICON_BUTTON, Hint } from './hint';

/**
 * Edit mode for the booking page: the pencil in the status card shows the
 * per-room actions in the rooms list. Off by default so the page reads as a
 * trip, not a form.
 */
const EditContext = React.createContext<{ editing: boolean; toggle: () => void }>({
  editing: false,
  toggle: () => {},
});

export function EditRoomsProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = React.useState(false);
  const value = React.useMemo(() => ({ editing, toggle: () => setEditing((e) => !e) }), [editing]);
  return <EditContext.Provider value={value}>{children}</EditContext.Provider>;
}

export function EditRoomsButton() {
  const { editing, toggle } = React.useContext(EditContext);
  const label = editing ? 'Done' : 'Edit rooms';
  return (
    <Hint label={label} text={editing ? null : 'Cancel a single room.'}>
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        aria-pressed={editing}
        className={cn(GLASS_ICON_BUTTON, editing && 'bg-white/25 hover:bg-white/30')}
        onClick={toggle}
      >
        {editing ? <Check aria-hidden /> : <Pencil aria-hidden />}
      </Button>
    </Hint>
  );
}

/** Rendered only while editing. */
export function WhenEditing({ children }: { children: React.ReactNode }) {
  return React.useContext(EditContext).editing ? <>{children}</> : null;
}
