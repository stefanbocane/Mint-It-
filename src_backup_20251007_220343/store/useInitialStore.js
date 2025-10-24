import { create } from 'zustand';

const useInitialStore = create(set => ({
  payload: null,
  setPayload: (data) => set({ payload: data }),
}));

export default useInitialStore; 