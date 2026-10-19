import React from 'react';
import { SIZE_PRESETS } from '../config/orderWorkflow';
import MultiSelectDropdown from './MultiSelectDropdown';

/**
 * The size-range picker for an order — a dropdown of size checkboxes.
 *
 * Two problems with the plain text box this replaces:
 *   1. A range is routinely 8–10 sizes (XS…4XL), and a narrow input truncated it,
 *      so a supervisor could not see — or check — what they had entered.
 *   2. Typing ten sizes by hand invites a missing or duplicated one, which then
 *      shows up as a production variance nobody can explain.
 *
 * So every standard size is offered as a CHECKBOX in a filterable dropdown, the
 * first two chosen sizes show as removable tags in the closed box, and a counter
 * badge beside the field shows exactly how many are selected. A size the ladder
 * does not list (a 7XL, or a numeric waist size) is still accepted through the
 * dropdown's "Add" row, so the control never blocks a real order.
 *
 * A full range is 8–10 sizes, so the box shows at most TWO tags and collapses
 * the rest into a "+N more" badge. That is what keeps a ten-size order on one
 * line — the box is a fixed height and never expands to break the form.
 *
 * The VALUE reported is the stored string form ("XS, S, M, L, XL…"), so the
 * saved record and every existing reader are unchanged.
 */
export default function SizeRangeInput({
  value = '',
  onChange,
  id,
  ariaLabel = 'Size range for this order',
  disabled = false,
  options = SIZE_PRESETS,
  // Two tags, then a "+N more" badge. See the note above on why this is fixed.
  maxVisibleTags = 2,
}) {
  return (
    <MultiSelectDropdown
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Select sizes…"
      searchPlaceholder="Search sizes…"
      addLabel="Other size…"
      ariaLabel={ariaLabel}
      disabled={disabled}
      maxVisibleTags={maxVisibleTags}
      className="sz-wrap"
      optionTone="msd-tone-size"
    />
  );
}
