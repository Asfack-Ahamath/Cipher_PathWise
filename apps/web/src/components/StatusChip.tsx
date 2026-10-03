/* One status language for every role (order lifecycle + connectivity).
   Offline is grey, never red: red means a rule is broken. */
export const STATUS = {
  confirmed:  { color: '#1D4ED8', bg: '#DBEAFE', label: 'Confirmed' },
  planned:    { color: '#4338CA', bg: '#E0E7FF', label: 'Planned' },
  loading:    { color: '#6D28D9', bg: '#EDE9FE', label: 'Loading' },
  loaded:     { color: '#6D28D9', bg: '#EDE9FE', label: 'Loaded' },
  outForDel:  { color: '#0F766E', bg: '#CCFBF1', label: 'Out for delivery' },
  arrived:    { color: '#0F766E', bg: '#CCFBF1', label: 'Arrived' },
  delivered:  { color: '#15803D', bg: '#DCFCE7', label: 'Delivered' },
  received:   { color: '#14532D', bg: '#BBF7D0', label: 'Received' },
  deferred:   { color: '#92400E', bg: '#FEF3C7', label: 'Deferred' },
  late:       { color: '#991B1B', bg: '#FEE2E2', label: 'Late' },
  partial:    { color: '#9A3412', bg: '#FFEDD5', label: 'Partial' },
  failed:     { color: '#991B1B', bg: '#FEE2E2', label: 'Failed' },
  disputed:   { color: '#9A3412', bg: '#FFEDD5', label: 'Disputed' },
  chilled:    { color: '#0369A1', bg: '#E0F2FE', label: 'Chilled' },
  ambient:    { color: '#374151', bg: '#F1F5F9', label: 'Ambient' },
  unconfirmed:{ color: '#92400E', bg: '#FEF3C7', label: 'Unconfirmed' },
  offline:    { color: '#4B5563', bg: '#E5E7EB', label: 'Offline' },
  syncing:    { color: '#4338CA', bg: '#E0E7FF', label: 'Syncing' },
  synced:     { color: '#15803D', bg: '#DCFCE7', label: 'Synced' },
  conflict:   { color: '#92400E', bg: '#FEF3C7', label: 'Sync conflict' },
};
