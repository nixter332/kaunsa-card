"use client";
// First run after sign-in: one step. Pick your cards, then land on your playbook.
// (The sign-in screen already showed what the app does, with sample answers.)
import { CardPicker } from "./CardPicker";

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  met: string[];
  onToggleCondition: (key: string) => void;
  onDone: () => void;
};

export function Onboarding({ selected, onToggle, met, onToggleCondition, onDone }: Props) {
  return (
    <div className="onboard">
      <div className="onboard-step">
        <h1 className="title">Which cards do you carry?</h1>
        <p className="muted">Pick every credit card you have. They stay on this phone, and you can change them later.</p>
        <CardPicker selected={selected} onToggle={onToggle} met={met} onToggleCondition={onToggleCondition} />
        <div className="onboard-actions sticky">
          <button type="button" className="btn primary wide" disabled={selected.length === 0} onClick={onDone}>
            {selected.length === 0 ? "Pick at least one card" : `Show the best card for each spend (${selected.length} ${selected.length === 1 ? "card" : "cards"})`}
          </button>
        </div>
      </div>
    </div>
  );
}
