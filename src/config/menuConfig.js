// ============================================================
// CENTRAL CONFIG — the ONE file to edit for menu structure,
// form fields, department→process lists, and standard targets.
// ============================================================

// ---- Department → Process lists (drives the dependent dropdown) ----
export const PROCESS_MAP = {
  Sewing: [
    'Collar Attach', 'Collar Join', 'Sleeve Attach', 'Sleeve Join',
    'Side Seam', 'Bottom Hem', 'Button Attach', 'Buttonhole',
    'Overlock', 'Placket', 'Yoke Join', 'Label Attach',
  ],
  Cutting: [
    'Main Fabric Cutting', 'Fusing Cutting', 'Pocketing Cutting',
    'Lining Cutting', 'Rib Cutting',
  ],
  Finishing: [
    'Thread Cutting', 'Ironing', 'Tagging', 'Poly Bagging',
    'Folding', 'Measurement Check', 'Buttoning Check',
  ],
  Iron: ['Ironing', 'Steam Press', 'Folding'],
};

// ---- Standard target per entry, per process (pcs). Used to
// auto-calculate Target/Due on production forms so nobody has
// to type a target by hand. Tune these to your real SMV data. ----
export const PROCESS_TARGETS = {
  'Collar Attach': 10, 'Collar Join': 12, 'Sleeve Attach': 12, 'Sleeve Join': 12,
  'Side Seam': 15, 'Bottom Hem': 18, 'Button Attach': 20, 'Buttonhole': 20,
  'Overlock': 16, 'Placket': 12, 'Yoke Join': 14, 'Label Attach': 25,
  'Main Fabric Cutting': 800, 'Fusing Cutting': 700, 'Pocketing Cutting': 700,
  'Lining Cutting': 600, 'Rib Cutting': 600,
  'Thread Cutting': 30, 'Ironing': 22, 'Tagging': 28, 'Poly Bagging': 26,
  'Folding': 24, 'Measurement Check': 20, 'Buttoning Check': 20,
  'Steam Press': 20,
};
export const DEFAULT_TARGET = 20;

// ---- Cutting-specific reasons for a shortfall (dropdown) ----
export const SHORTFALL_REASONS = [
  'Machine breakdown', 'Fabric shortage', 'Power outage',
  'Left floor briefly', 'Line setup / style change', 'Other',
];

// ---- Sample color list with color codes, for washing screens ----
export const COLOR_LIST = [
  { name: 'Black', code: '8181' },
  { name: 'Navy', code: '4023' },
  { name: 'White', code: '0001' },
  { name: 'Grey Melange', code: '6612' },
  { name: 'Maroon', code: '3390' },
];

export const menu = [
  {
    key: 'production',
    label: 'Sewing Department',
    icon: '🧵',
    accent: '#f59e0b',
    items: [
      {
        key: 'daily-production',
        label: 'Daily Production',
        icon: '📋',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        autoTarget: true,
        // The screen itself is the dedicated DailyProductionModule (a three-section
        // Excel-template form + summary table). This field list survives as the
        // recorded row shape: the first five keys are what every existing screen
        // (Production Report, Line Status, Target vs Actual) reads, and the rest are
        // additive. `quantity` is kept, and is mirrored from the day's good output
        // on save, so nothing that already reads a daily-production row breaks.
        fields: [
          { name: 'date', label: 'Production Date', type: 'date' },
          { name: 'employee', label: 'Line / Employee', type: 'employee-select' },
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'department', label: 'Department', type: 'department-select' },
          { name: 'process', label: 'Operation / Process', type: 'process-select', dependsOn: 'department' },
          { name: 'quantity', label: 'Quantity', type: 'number' },
          { name: 'buyer', label: 'Buyer', type: 'buyer-select' },
          { name: 'order_no', label: 'Order No', type: 'order-select' },
          { name: 'item', label: 'Product / Item', type: 'text' },
          { name: 'color', label: 'Color', type: 'color-select' },
          { name: 'size_range', label: 'Size Range', type: 'text' },
          { name: 'po_qty', label: 'PO Qty', type: 'number' },
          { name: 'floor', label: 'Floor', type: 'floor-select' },
          { name: 'line_no', label: 'Line No', type: 'text' },
          { name: 'shift', label: 'Shift', type: 'shift-select' },
          { name: 'supervisor', label: 'Supervisor', type: 'employee-select' },
          { name: 'working_hours', label: 'Working Hours', type: 'number' },
          { name: 'manpower', label: 'Manpower', type: 'number' },
          { name: 'daily_target', label: 'Daily Target', type: 'number' },
        ],
      },
      {
        key: 'production-line',
        label: 'Production Line',
        icon: '🏗️',
        variant: 'line-status',
        downloadable: true,
      },
      {
        key: 'worker-production',
        label: 'Worker Production',
        icon: '👥',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'line', label: 'Line', type: 'text' },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'output', label: 'Output Qty', type: 'number' },
        ],
      },
      {
        key: 'hourly-production',
        label: 'Hourly Production',
        icon: '⏱️',
        variant: 'hourly-timesheet',
        downloadable: true,
        // A parent with children: the sidebar renders these nested underneath
        // (and nests them for every other category too — this is not a special
        // case). The parent itself is NOT clickable as a page when it has
        // children; it expands. Its own view is still reachable at its route,
        // so an existing bookmark to /production/hourly-production keeps working.
        children: [
          {
            key: 'daily-production-entry',
            label: 'Daily Production Entry',
            icon: '📝',
            // Rendered as a full page by DailyProductionEntry (see DataModule),
            // which is the same three-section Hourly Production Tracking form the
            // Daily Production screen opens in a modal.
            variant: 'daily-production-entry',
            userCanAdd: true,
            downloadable: true,
          },
        ],
      },
      {
        key: 'target-vs-actual',
        label: 'Target vs Actual',
        icon: '🎯',
        variant: 'employee-chart',
        downloadable: false,
      },
      {
        key: 'quality-control',
        label: 'Quality Control',
        icon: '🔍',
        variant: 'quality-control',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'line', label: 'Line', type: 'text' },
          { name: 'process', label: 'Process (where defect found)', type: 'process-select-all' },
          { name: 'checked', label: 'Checked Qty', type: 'number' },
          { name: 'defect_qty', label: 'Defect Qty', type: 'number' },
        ],
      },
      {
        key: 'order-model',
        label: 'Order / Model',
        icon: '📦',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'buyer', label: 'Buyer', type: 'text' },
          { name: 'style', label: 'Style', type: 'text' },
          { name: 'qty', label: 'Order Qty', type: 'number' },
          { name: 'start_date', label: 'Work Start Date', type: 'date' },
          { name: 'ship_date', label: 'Delivery Date', type: 'date' },
        ],
      },
      {
        key: 'production-report',
        label: 'Production Report',
        icon: '📈',
        variant: 'production-report',
        source: 'daily-production',
        downloadable: true,
      },
    ],
  },

  {
    key: 'cutting',
    label: 'Cutting Department',
    icon: '✂️',
    accent: '#22d3ee',
    items: [
      {
        key: 'cutting-plan',
        label: 'Cutting Plan',
        icon: '🗂️',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'start_date', label: 'Cutting Start Date', type: 'date' },
          { name: 'colors', label: 'No. of Colors', type: 'number' },
          { name: 'daily_qty', label: 'Qty to Cut Per Day', type: 'number' },
          { name: 'note', label: 'Cutting Layout Note / Image Link', type: 'text' },
        ],
      },
      {
        key: 'cutting-production',
        label: 'Cutting Production',
        icon: '🧵',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        autoTarget: true,
        shortfallReason: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'color', label: 'Color', type: 'color-select' },
          { name: 'lay_qty', label: 'No. of Lay', type: 'number' },
          { name: 'quantity', label: 'Cut Quantity', type: 'number' },
        ],
      },
      {
        key: 'fabric-material',
        label: 'Fabric / Material',
        icon: '🧶',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'fabric', label: 'Fabric Name', type: 'text' },
          { name: 'lot_no', label: 'Lot No', type: 'text' },
          { name: 'received_qty', label: 'Received Qty', type: 'number' },
          { name: 'issued_qty', label: 'Issued Qty', type: 'number' },
        ],
      },
      {
        key: 'cutting-report',
        label: 'Cutting Report',
        icon: '📄',
        variant: 'cutting-report',
        source: 'cutting-production',
        downloadable: true,
      },
    ],
  },

  {
    key: 'attendance',
    label: 'Attendance',
    icon: '🧑‍🤝‍🧑',
    accent: '#a78bfa',
    items: [
      {
        key: 'daily-attendance',
        label: 'Daily Attendance',
        icon: '📅',
        variant: 'attendance',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'department', label: 'Department', type: 'department-select' },
          { name: 'in_time', label: 'In Time', type: 'time' },
        ],
      },
      {
        key: 'present-absent',
        label: 'Present / Absent',
        icon: '✅',
        variant: 'present-absent',
        source: 'daily-attendance',
        downloadable: false,
      },
      // The "Monthly Metrics" entry that used to sit here has been removed: the monthly
      // metrics are already rendered inside the Present / Absent view above, so a second
      // sidebar link only duplicated the same screen.
      {
        key: 'late',
        label: 'Late',
        icon: '⏰',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'scheduled_time', label: 'Scheduled Time', type: 'text' },
          { name: 'actual_time', label: 'Actual Time', type: 'text' },
          { name: 'minutes_late', label: 'Minutes Late', type: 'number' },
        ],
      },
      {
        key: 'attendance-leave',
        label: 'Leave',
        icon: '🗓️',
        variant: 'table',
        // Leave rows are derived from the Smart Attendance collection, so there is no
        // manual entry form on this page.
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'leave_type', label: 'Leave Type', type: 'select', options: ['Sick', 'Casual', 'Earned', 'Emergency'] },
          { name: 'from_date', label: 'From', type: 'date' },
          { name: 'to_date', label: 'To', type: 'date' },
          { name: 'comment', label: 'Comment', type: 'textarea' },
        ],
      },
      {
        key: 'attendance-report',
        label: 'Attendance Report',
        icon: '📊',
        variant: 'report',
        source: 'daily-attendance',
        downloadable: true,
      },
      {
        // The Excel register lives in its own page (pages/AttendanceExport.jsx), so it
        // carries a dedicated variant instead of the generic table renderer. Its key must
        // stay in step with the `/attendance/${key}` route that App.jsx generates.
        key: 'monthly-export',
        label: 'Monthly Attendance Export',
        icon: '📈',
        variant: 'attendance-export',
        downloadable: false,
      },
    ],
  },

  {
    key: 'finishing',
    label: 'Finishing Department',
    icon: '🧷',
    accent: '#fb7185',
    items: [
      {
        key: 'finishing-plan',
        label: 'Finishing Plan',
        icon: '📐',
        variant: 'finishing-plan',
        downloadable: false,
      },
      {
        key: 'finishing-production',
        label: 'Finishing Production',
        icon: '🪡',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        autoTarget: true,
        lockedDepartment: 'Finishing',
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'department', label: 'Department', type: 'locked-department' },
          { name: 'process', label: 'Process', type: 'process-select', dependsOn: 'department' },
          { name: 'quantity', label: 'Quantity', type: 'number' },
        ],
      },
      {
        key: 'quality-check',
        label: 'Quality Check',
        icon: '🔎',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        diffCalc: { target: 'target', actual: 'checked' },
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'hour_slot', label: 'Hour Slot', type: 'text' },
          { name: 'target', label: 'Target (pcs/hr)', type: 'number' },
          { name: 'checked', label: 'Checked Qty', type: 'number' },
          { name: 'altered', label: 'Altered Qty', type: 'number' },
          { name: 'final', label: 'Final Qty', type: 'number' },
          { name: 'faulty', label: 'Faulty Qty', type: 'number' },
        ],
      },
      {
        key: 'finishing-report',
        label: 'Finishing Report',
        icon: '📄',
        variant: 'finishing-report',
        source: 'finishing-production',
        downloadable: true,
      },
    ],
  },

  {
    key: 'washing',
    label: 'Washing Plan',
    icon: '🫧',
    accent: '#2dd4bf',
    items: [
      {
        key: 'washing-plan',
        label: 'Washing Plan',
        icon: '🗒️',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'washable', label: 'Washable?', type: 'select', options: ['Yes', 'No'] },
          { name: 'ready_qty', label: 'Ready to Send Qty', type: 'number' },
          { name: 'pending_qty', label: 'Pending (not back from wash)', type: 'number' },
        ],
      },
      {
        key: 'send-to-washing',
        label: 'Send to Washing',
        icon: '📤',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'color', label: 'Color', type: 'color-select' },
          { name: 'qty_sent', label: 'Qty Sent', type: 'number' },
        ],
      },
      {
        key: 'received-from-washing',
        label: 'Received from Washing',
        icon: '📥',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'color', label: 'Color', type: 'color-select' },
          { name: 'qty_received', label: 'Qty Received', type: 'number' },
        ],
      },
      {
        key: 'washing-status',
        label: 'Washing Status',
        icon: '🚦',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'color', label: 'Color', type: 'color-select' },
          { name: 'status', label: 'Status', type: 'select', options: ['Approved', 'Pending', 'In Process'] },
        ],
      },
      {
        key: 'washing-report',
        label: 'Washing Report',
        icon: '📄',
        variant: 'report',
        source: 'washing-status',
        downloadable: true,
      },
    ],
  },

  {
    key: 'delivery',
    label: 'Delivery',
    icon: '🚚',
    accent: '#a3e635',
    items: [
      {
        key: 'delivery-plan',
        label: 'Delivery Plan',
        icon: '🗺️',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'qty', label: 'Qty', type: 'number' },
          { name: 'ship_date', label: 'Delivery Due Date', type: 'date' },
          { name: 'urgency', label: 'Urgency', type: 'select', options: ['Normal', 'Urgent', 'Critical'] },
        ],
      },
      {
        key: 'ready-for-delivery',
        label: 'Ready for Delivery',
        icon: '📦',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'qty', label: 'Qty', type: 'number' },
          { name: 'date_ready', label: 'Date Ready', type: 'date' },
        ],
      },
      {
        key: 'delivered',
        label: 'Delivered',
        icon: '✅',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'qty', label: 'Qty', type: 'number' },
          { name: 'delivery_date', label: 'Delivery Date', type: 'date' },
          { name: 'carrier', label: 'Carrier', type: 'text' },
        ],
      },
      {
        key: 'pending-delivery',
        label: 'Pending Delivery',
        icon: '⏳',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'qty', label: 'Qty', type: 'number' },
          { name: 'status', label: 'Status', type: 'select', options: ['In Process', 'Delivered', 'Pending'] },
        ],
      },
      {
        key: 'delivery-report',
        label: 'Delivery Report',
        icon: '📄',
        variant: 'report',
        source: 'delivered',
        downloadable: true,
      },
    ],
  },

  // ============================================================
  // PRODUCTION PLANNING & CONTROL — five sections that appear directly
  // in the main sidebar, alongside Sewing, Cutting, Attendance and the
  // rest. They are plain categories in this array, so the existing
  // Sidebar and the router pick them up with no special casing: a
  // category here is one expandable group in the drawer and one route
  // per item in App.jsx.
  // ============================================================
  {
    key: 'orders',
    label: 'Order Management',
    icon: '📑',
    accent: '#f59e0b',
    items: [
      {
        key: 'order-list',
        label: 'Order List',
        icon: '📋',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        fields: [
          { name: 'order_no', label: 'Order No', type: 'text' },
          { name: 'buyer', label: 'Buyer', type: 'text' },
          { name: 'style', label: 'Style', type: 'text' },
          { name: 'qty', label: 'Order Qty', type: 'number' },
          { name: 'order_date', label: 'Order Date', type: 'date' },
          { name: 'ship_date', label: 'Delivery Date', type: 'date' },
        ],
      },
      {
        key: 'order-input',
        label: 'Order Input',
        icon: '📝',
        variant: 'order-input',
        userCanAdd: true,
        downloadable: false,
      },
      {
        // Sits directly under Order Input, because a process sheet belongs to an
        // order: the operations it carries are linked back through the style.
        key: 'process-upload',
        label: 'Process Sheet Upload',
        icon: '📤',
        variant: 'process-upload',
        userCanAdd: true,
        downloadable: false,
      },
    ],
  },

  {
    key: 'tna',
    label: 'TNA Management',
    icon: '🗓️',
    accent: '#fb923c',
    items: [
      {
        key: 'tna-calendar',
        label: 'TNA Calendar',
        icon: '📅',
        variant: 'tna-calendar',
        userCanAdd: true,
        downloadable: true,
      },
      {
        key: 'tna-tasks',
        label: 'Action Tasks',
        icon: '✅',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        fields: [
          { name: 'stage', label: 'Stage / Milestone', type: 'text' },
          { name: 'order_no', label: 'Order No', type: 'text' },
          { name: 'responsible', label: 'Responsible', type: 'text' },
          { name: 'planned_date', label: 'Planned Date', type: 'date' },
          { name: 'actual_date', label: 'Actual Date', type: 'date' },
          { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Completed', 'Delayed'] },
        ],
      },
    ],
  },

  {
    key: 'manpower',
    label: 'Manpower Management',
    icon: '🧑‍🏭',
    accent: '#f472b6',
    items: [
      {
        // The employee directory. This screen issues the Employee IDs that every
        // other form in the app selects from, so it is a dedicated page rather
        // than the generic field-driven table: a name and a generated ID are the
        // whole record, and the old date/line/shift head-count grid was removed.
        key: 'manpower-deployment',
        label: 'Line Deployment',
        icon: '👥',
        variant: 'line-deployment',
        userCanAdd: true,
        downloadable: true,
      },
      {
        key: 'manpower-absent',
        label: 'Absenteeism',
        icon: '🚫',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'line', label: 'Line', type: 'text' },
          { name: 'absent', label: 'Absent Count', type: 'number' },
          { name: 'note', label: 'Note', type: 'text' },
        ],
      },
    ],
  },

  {
    key: 'operator',
    label: 'Operator Performance',
    icon: '👷',
    accent: '#a855f7',
    items: [
      {
        key: 'operator-output',
        label: 'Operator Output',
        icon: '🏭',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'employee', label: 'Operator', type: 'employee-select' },
          { name: 'line', label: 'Line', type: 'text' },
          { name: 'process', label: 'Operation', type: 'process-select-all' },
          { name: 'target', label: 'Target (pcs)', type: 'number' },
          { name: 'achieved', label: 'Achieved (pcs)', type: 'number' },
        ],
      },
      {
        key: 'operator-efficiency',
        label: 'Efficiency %',
        icon: '📈',
        variant: 'table',
        userCanAdd: false,
        downloadable: true,
        diffCalc: { target: 'target', actual: 'achieved' },
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'employee', label: 'Operator', type: 'employee-select' },
          { name: 'process', label: 'Operation', type: 'process-select-all' },
          { name: 'target', label: 'Target', type: 'number' },
          { name: 'achieved', label: 'Achieved', type: 'number' },
        ],
      },
    ],
  },

  {
    key: 'qc',
    label: 'Quality Control',
    icon: '🔍',
    accent: '#22d3ee',
    items: [
      {
        key: 'qc-check',
        label: 'QC Check',
        icon: '🧪',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'line', label: 'Line', type: 'text' },
          { name: 'process', label: 'Process Checked', type: 'process-select-all' },
          { name: 'checked', label: 'Checked Qty', type: 'number' },
          { name: 'passed', label: 'Passed Qty', type: 'number' },
          { name: 'defect_qty', label: 'Defect Qty', type: 'number' },
        ],
      },
      {
        key: 'qc-defects',
        label: 'Defect Tracking',
        icon: '🐞',
        variant: 'quality-control',
        userCanAdd: true,
        downloadable: true,
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'line', label: 'Line', type: 'text' },
          { name: 'process', label: 'Process (where defect found)', type: 'process-select-all' },
          { name: 'checked', label: 'Checked Qty', type: 'number' },
          { name: 'defect_qty', label: 'Defect Qty', type: 'number' },
        ],
      },
    ],
  },

  {
    key: 'leave',
    label: 'Leave',
    icon: '🕘',
    accent: '#38bdf8',
    items: [
      {
        key: 'leave-requests',
        label: 'Leave Requests',
        icon: '🗓️',
        variant: 'table',
        userCanAdd: true,
        downloadable: true,
        fields: [
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'leave_type', label: 'Leave Type', type: 'select', options: ['Sick', 'Casual', 'Earned', 'Emergency'] },
          { name: 'from_date', label: 'From', type: 'date' },
          { name: 'to_date', label: 'To', type: 'date' },
          { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Rejected'] },
          { name: 'comment', label: 'Comment', type: 'textarea' },
        ],
      },
    ],
  },
];

export const salaryConfig = {
  key: 'salary',
  label: 'Salary',
  icon: '💰',
  accent: '#e879f9',
  fields: [
    { name: 'name', label: 'Employee Name', type: 'employee-select' },
    { name: 'department', label: 'Department', type: 'department-select' },
    { name: 'base_salary', label: 'Base Salary', type: 'number' },
    { name: 'bonus', label: 'Bonus', type: 'number' },
    { name: 'status', label: 'Status', type: 'select', options: ['Processing', 'Paid'] },
  ],
};

export const payrollConfig = {
  key: 'payroll',
  label: 'Payroll Worksheet',
  icon: '🧾',
};

export const attendanceSheetConfig = {
  key: 'attendance-sheet',
  label: 'Smart Attendance',
  icon: '📅',
};

export const attendanceExportConfig = {
  key: 'attendance-export',
  label: 'Monthly Attendance Export',
  icon: '📊',
};

export function findModuleItem(catKey, itemKey) {
  const cat = menu.find((c) => c.key === catKey);
  if (!cat) return null;
  const item = cat.items.find((i) => i.key === itemKey);
  if (!item) return null;
  return { category: cat, item };
}

// The single place a module URL is spelled out. The sidebar builds its click targets with
// it and App.jsx builds its routes with it, so the two can never drift apart — a mismatch
// there meant a sub-button navigated to a path no route matched and the catch-all bounced
// the visitor back to the Dashboard.
export function modulePath(catKey, itemKey) {
  return `/${catKey}/${itemKey}`;
}

/**
 * The URL of a nested sub-item, built from the same keys App.jsx generates the
 * nested route with. Kept beside `modulePath` for the same reason: the sidebar's
 * click target and the router's path are spelled out in one place, so a nested
 * button can never navigate to a URL no route matches.
 */
export function childModulePath(catKey, parentKey, childKey) {
  return `/${catKey}/${parentKey}/${childKey}`;
}

/**
 * Every navigable target in the menu, flattened, as data.
 *
 * The router (App.jsx) and this file are the only two places that need to know
 * the full path set, so it is derived here once rather than walked inline in the
 * route table. A nested child is an entry of its own, carrying the parent it sits
 * under, which is what lets the router pass `parentItem` to the page.
 *
 * `isParent` marks a top-level item that also has children: the sidebar renders
 * it as a disclosure control, but it keeps its own route so an existing bookmark
 * to the parent path still resolves.
 */
export function navigableTargets() {
  const targets = [];
  (Array.isArray(menu) ? menu : []).forEach((cat) => {
    if (!cat?.key || !Array.isArray(cat.items)) return;
    cat.items.forEach((item) => {
      if (!item?.key) return;
      const children = Array.isArray(item.children) ? item.children.filter((c) => c?.key) : [];
      targets.push({
        path: modulePath(cat.key, item.key),
        category: cat,
        item,
        parentItem: null,
        isParent: children.length > 0,
        depth: 0,
      });
      children.forEach((child) => {
        targets.push({
          path: childModulePath(cat.key, item.key, child.key),
          category: cat,
          item: child,
          parentItem: item,
          isParent: false,
          depth: 1,
        });
      });
    });
  });
  return targets;
}

/**
 * The nested children of one menu item, as clickable targets. Returns [] for an
 * item with no children, so the sidebar can branch on `.length` alone.
 */
export function childTargetsOf(catKey, itemKey) {
  return navigableTargets().filter(
    (t) => t.depth === 1 && t.category?.key === catKey && t.parentItem?.key === itemKey,
  );
}
