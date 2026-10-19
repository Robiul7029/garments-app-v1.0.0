import React from 'react';
import { COLOR_SUGGESTIONS } from '../config/orderWorkflow';
import MultiSelectDropdown from './MultiSelectDropdown';

/**
 * The Colour field for an order — a searchable checkbox dropdown.
 *
 * An order routinely carries several colours (Navy, Black, Red…). This control
 * offers each known colour as a CHECKBOX in a filterable dropdown, shows the
 * first two chosen colours as removable tags in the closed box, and carries a
 * small counter badge beside the field so the exact number selected is always
 * visible.
 *
 * The box shows at most TWO tags: past that the remainder collapse into a
 * "+N more" badge, so a ten-colour order occupies the same single line as a
 * one-colour order. It sits beside the Size Range field in one grid row, and a
 * box that grew with the selection would push that row out of alignment.
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
  // Two tags, then a "+N more" badge. See the note above on why this is fixed.
  maxVisibleTags = 2,
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
      maxVisibleTags={maxVisibleTags}
      className="ct-wrap"
      optionTone="msd-tone-color"
    />
  );
}
