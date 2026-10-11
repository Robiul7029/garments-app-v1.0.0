import React from 'react';
import { COLOR_SUGGESTIONS } from '../config/orderWorkflow';
import MultiSelectDropdown from './MultiSelectDropdown';

/**
 * The Colour field for an order — a searchable checkbox dropdown.
 *
 * An order routinely carries several colours (Navy, Black, Red…). This control
 * offers each known colour as a CHECKBOX in a filterable dropdown, shows the
 * chosen ones as removable chips in the closed box, and carries a small counter
 * badge beside the field so the exact number selected is always visible.
 *
 * A colour the list does not carry is still accepted: type it in the dropdown's
 * "Add" row (or the search box, then Enter) and it becomes a chip. The control
 * therefore never blocks a real order, however unusual its colourway.
 *
 * The VALUE it reports is always the stored string form ("Navy, Black"), so the
 * caller saves a plain CSV string and every existing reader of `row.color`
 * keeps working unchanged.
 */
export default function ColorTagInput({
  value = '',
  onChange,
  placeholder = 'Select colours…',
  id,
  ariaLabel = 'Colours on this order',
  suggestions = COLOR_SUGGESTIONS,
  disabled = false,
}) {
  return (
    <MultiSelectDropdown
      id={id}
      value={value}
      onChange={onChange}
      options={suggestions}
      placeholder={placeholder}
      searchPlaceholder="Search colours…"
      addLabel="Add a colour…"
      ariaLabel={ariaLabel}
      disabled={disabled}
      className="ct-wrap"
      optionTone="msd-tone-color"
    />
  );
}
