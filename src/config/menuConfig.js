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
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'employee', label: 'Employee Name', type: 'employee-select' },
          { name: 'style', label: 'Style', type: 'style-select' },
          { name: 'department', label: 'Department', type: 'department-select' },
          { name: 'process', label: 'Process', type: 'process-select', dependsOn: 'department' },
          { name: 'quantity', label: 'Quantity', type: 'number' },
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
        userCanAdd: true,
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
