import { create } from 'zustand';

/**
 * Global, persisted operations filter — pick a function once and every page that
 * reads it stays scoped to that function. Empty functionId = all functions.
 */
interface FilterState {
  functionId: string;
  functionName: string;
  setFunction: (id: string, name: string) => void;
  clearFunction: () => void;
}

const savedId = localStorage.getItem('flt.functionId') ?? '';
const savedName = localStorage.getItem('flt.functionName') ?? '';

export const useFilterStore = create<FilterState>((set) => ({
  functionId: savedId,
  functionName: savedName,
  setFunction: (functionId, functionName) => {
    localStorage.setItem('flt.functionId', functionId);
    localStorage.setItem('flt.functionName', functionName);
    set({ functionId, functionName });
  },
  clearFunction: () => {
    localStorage.removeItem('flt.functionId');
    localStorage.removeItem('flt.functionName');
    set({ functionId: '', functionName: '' });
  },
}));
