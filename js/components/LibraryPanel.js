import { ref, computed } from 'vue';

export default {
  name: 'LibraryPanel',
  props: {
    items: { type: Array, default: () => [] },
    activeId: { type: String, default: null },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const search = ref('');
    const openCat = ref(null);

    const categories = computed(() => {
      const map = {};
      for (const it of props.items) {
        const cat = it.category || 'Khác';
        if (!map[cat]) map[cat] = [];
        map[cat].push(it);
      }
      return map;
    });

    const filtered = computed(() => {
      const q = search.value.trim().toLowerCase();
      if (!q) return categories.value;
      const out = {};
      for (const [cat, list] of Object.entries(categories.value)) {
        const matched = list.filter(it => it.name.toLowerCase().includes(q));
        if (matched.length) out[cat] = matched;
      }
      return out;
    });

    function toggle(cat) {
      openCat.value = openCat.value === cat ? null : cat;
    }

    return { search, openCat, filtered, toggle, emit };
  },
  template: `
    <div class="d-flex flex-column h-100 bg-white border-end shadow-sm">
      <div class="p-3 border-bottom">
        <h6 class="fw-bold mb-2">Thư viện model</h6>
        <input v-model="search" type="text" class="form-control form-control-sm"
               placeholder="Tìm kiếm..." />
      </div>

      <div class="flex-grow-1 overflow-auto p-2">
        <div v-for="(list, cat) in filtered" :key="cat" class="mb-1">
          <div class="d-flex align-items-center px-2 py-1 rounded"
               style="cursor:pointer; user-select:none"
               :class="{'bg-light': openCat === cat}"
               @click="toggle(cat)">
            <small class="me-1">{{ openCat === cat ? '▾' : '▸' }}</small>
            <span class="fw-semibold small">{{ cat }}</span>
            <span class="badge bg-secondary ms-auto">{{ list.length }}</span>
          </div>

          <div v-if="openCat === cat || search.trim()">
            <div v-for="item in list" :key="item.id"
                 class="lib-item d-flex align-items-center gap-2 ps-4"
                 :class="{ active: item.id === activeId }"
                 @click="$emit('select', item)">
              <span>{{ item.name }}</span>
            </div>
          </div>
        </div>

        <div v-if="Object.keys(filtered).length === 0"
             class="text-muted small text-center mt-4">
          Không tìm thấy model nào
        </div>
      </div>
    </div>
  `,
};
