import { describe, it, expect } from 'vitest';

import { departmentChoices, departmentOptions, departmentPatch, MAX_DEPARTMENT_NAME } from '../roomDepartment';

describe('the room Inspector\'s Department field (v0.14.9)', () => {
  it('the choices: the page\'s names in its order, each once (by words), names or { name }', () => {
    expect(departmentChoices([{ name: 'HR', description: 'People' }, 'Finance', { name: ' Sales ' }, 'hr', { name: 'Data  & AI' }, 'data ai']))
      .toEqual(['HR', 'Finance', 'Sales', 'Data & AI']);
  });
  it('none given (or nothing usable): null, the field is free text', () => {
    expect(departmentChoices(undefined)).toBeNull();
    expect(departmentChoices(null)).toBeNull();
    expect(departmentChoices([])).toBeNull();
    expect(departmentChoices([{ name: '  ' }, null, 3, { id: 1 }])).toBeNull();
  });
  it('the options: None first, then the choices; the room\'s value matched by words', () => {
    const choices = ['HR', 'Finance', 'Data & AI'];
    expect(departmentOptions(choices, undefined)).toEqual({
      value: '', options: [{ value: '', label: 'None' }, { value: 'HR', label: 'HR' }, { value: 'Finance', label: 'Finance' },
        { value: 'Data & AI', label: 'Data & AI' }],
    });
    expect(departmentOptions(choices, ' data ai ').value).toBe('Data & AI');
    expect(departmentOptions(choices, '').value).toBe('');
  });
  it('a department not in the list is kept and shown as such', () => {
    const { value, options } = departmentOptions(['HR'], 'Engineering');
    expect(value).toBe('Engineering');
    expect(options.at(-1)).toEqual({ value: 'Engineering', label: 'Engineering (not in the list)' });
  });
  it('the patch: trimmed, one space between words, at most 80 characters; empty or None = no department', () => {
    expect(departmentPatch('  Customer   Success ')).toEqual({ departmentRef: 'Customer Success' });
    expect(departmentPatch('')).toEqual({ departmentRef: undefined });
    expect(departmentPatch('   ')).toEqual({ departmentRef: undefined });
    expect(departmentPatch(undefined)).toEqual({ departmentRef: undefined });
    expect(departmentPatch('x'.repeat(100)).departmentRef).toHaveLength(MAX_DEPARTMENT_NAME);
  });
});
