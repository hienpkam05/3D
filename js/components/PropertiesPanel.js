import { computed } from 'vue';

export default {
  name: 'PropertiesPanel',
  props: {
    decoration: { type: Object, default: null },
    decorations: { type: Array, default: () => [] },
    selectedId: { type: String, default: null },
  },
  emits: ['update', 'select-deco', 'delete'],
  setup(props, { emit }) {
    const pos = computed(() => props.decoration?.position || { x: 0, y: 0, z: 0 });
    const rot = computed(() => props.decoration?.rotation || { x: 0, y: 0, z: 0 });
    const scl = computed(() => props.decoration?.scale || { x: 1, y: 1, z: 1 });

    function updateField(group, axis, val) {
      const num = parseFloat(val);
      if (isNaN(num)) return;
      emit('update', { field: group, axis, value: num });
    }

    function updateUniformScale(val) {
      const num = parseFloat(val);
      if (isNaN(num) || num <= 0) return;
      emit('update', { field: 'scale', axis: 'uniform', value: num });
    }

    return { pos, rot, scl, updateField, updateUniformScale };
  },
  template: `
    <div class="d-flex flex-column h-100 bg-white border-start shadow-sm">
      <!-- Properties section -->
      <div v-if="decoration" class="border-bottom">
        <div class="p-3 border-bottom bg-light">
          <h6 class="fw-bold mb-0 small">Thuộc tính</h6>
          <small class="text-muted">{{ decoration.name }}</small>
        </div>

        <div class="p-3">
          <!-- Position -->
          <label class="form-label small fw-semibold mb-1">Vị trí</label>
          <div class="d-flex gap-1 mb-2">
            <div v-for="a in ['x','y','z']" :key="'p'+a" class="input-group input-group-sm">
              <span class="input-group-text prop-label">{{ a.toUpperCase() }}</span>
              <input type="number" step="0.1" class="form-control prop-input"
                     :value="pos[a].toFixed(2)"
                     @change="updateField('position', a, $event.target.value)" />
            </div>
          </div>

          <!-- Rotation Y -->
          <label class="form-label small fw-semibold mb-1">Góc xoay (Y)</label>
          <div class="d-flex gap-1 mb-2">
            <div class="input-group input-group-sm">
              <span class="input-group-text prop-label">°</span>
              <input type="number" step="1" class="form-control prop-input"
                     :value="rot.y.toFixed(1)"
                     @change="updateField('rotation', 'y', $event.target.value)" />
            </div>
          </div>

          <!-- Scale -->
          <label class="form-label small fw-semibold mb-1">Kích thước</label>
          <div class="d-flex gap-1 mb-2">
            <div class="input-group input-group-sm">
              <span class="input-group-text prop-label">S</span>
              <input type="number" step="0.1" min="0.01" class="form-control prop-input"
                     :value="scl.x.toFixed(2)"
                     @change="updateUniformScale($event.target.value)" />
            </div>
          </div>
        </div>
      </div>

      <div v-else class="p-3 border-bottom">
        <p class="text-muted small mb-0">Chọn 1 vật trang trí trên bản đồ hoặc chọn model từ thư viện để đặt.</p>
      </div>

      <!-- Placed decorations list -->
      <div class="p-3 border-bottom bg-light">
        <h6 class="fw-bold mb-0 small">Đã đặt ({{ decorations.length }})</h6>
      </div>
      <div class="flex-grow-1 overflow-auto">
        <div v-if="decorations.length === 0" class="p-3 text-muted small text-center">
          Chưa có vật trang trí nào
        </div>
        <div v-for="d in decorations" :key="d.id"
             class="deco-item d-flex align-items-center justify-content-between px-3 py-2 border-bottom"
             :class="{ active: d.id === selectedId }"
             @click="$emit('select-deco', d.id)">
          <span class="small">{{ d.name || d.id }}</span>
          <button class="btn btn-sm btn-outline-danger py-0 px-1"
                  @click.stop="$emit('delete', d.id)" title="Xóa">
            ✕
          </button>
        </div>
      </div>
    </div>
  `,
};
