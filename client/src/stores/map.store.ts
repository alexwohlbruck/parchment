import { ref } from "vue";

export type BaseMap = "standard" | "satellite";

export function useMapStore() {
  const baseMap = ref<BaseMap>("standard");

  function setBaseMap(map: BaseMap) {
    baseMap.value = map;
  }

  return {
    baseMap,
    setBaseMap,
  };
}
