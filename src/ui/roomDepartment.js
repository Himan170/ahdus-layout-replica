/**
 * ui/roomDepartment.js (v0.14.9, private-docs/EXPERIENCE_PLAN.md 3.5): PURE rules of the room Inspector's
 * "Department" field (saved as room.departmentRef, which Find and the company tour use; without it they take the
 * department of most of the people seated in the room, places.roomDepartments).
 *
 * The choices are the departments the page gives (AHDUS: GET /api/teams/departments; <LayoutEditor departments>),
 * plus "None". When the page gives none, the field is free text. Not the furniture "Department" field.
 */

import { words } from '../play/navigation/places';

/** The longest department name the field takes (characters). */
export const MAX_DEPARTMENT_NAME = 80;

const keyOf = (name) => words(name).join(' ');

/**
 * The names to choose from, in the page's order, each once (by words: "Data & AI" = "data ai"); null: none given
 * (the field is free text). Takes names or { name }.
 */
export function departmentChoices(departments) {
  if (!Array.isArray(departments)) return null;
  const seen = new Set();
  const out = [];
  for (const d of departments) {
    const raw = typeof d === 'string' ? d : d && typeof d.name === 'string' ? d.name : '';
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_DEPARTMENT_NAME);
    const key = keyOf(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.length ? out : null;
}

/**
 * The select's options and value for a room: "None" (value ''), the choices, and the room's own department when it
 * is not one of them (an older layout's name: kept, marked "not in the list", until another is picked).
 * @returns {{ value: string, options: { value: string, label: string }[] }}
 */
export function departmentOptions(choices, current) {
  const options = [{ value: '', label: 'None' }, ...(choices ?? []).map((c) => ({ value: c, label: c }))];
  const cur = typeof current === 'string' ? current.trim() : '';
  if (!cur) return { value: '', options };
  const match = (choices ?? []).find((c) => keyOf(c) === keyOf(cur));
  if (match) return { value: match, options };
  return { value: cur, options: [...options, { value: cur, label: `${cur} (not in the list)` }] };
}

/** The room patch for a chosen or typed department: trimmed, at most MAX_DEPARTMENT_NAME; empty = none. */
export function departmentPatch(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_DEPARTMENT_NAME) : '';
  return { departmentRef: name || undefined };
}
