export default {
  name: 'EditorToolbar',
  props: {
    placementMode: { type: Boolean, default: false },
    hasSelection: { type: Boolean, default: false },
    placingName: { type: String, default: '' },
  },
  emits: ['save', 'delete', 'cancel-place'],
  template: `
    <div class="editor-toolbar">
      <div class="btn-group shadow-sm">
        <button v-if="placementMode" class="btn btn-warning btn-sm"
                @click="$emit('cancel-place')">
          ✕ Hủy đặt
        </button>
        <span v-if="placementMode" class="btn btn-light btn-sm disabled">
          Click vào bản đồ để đặt: <b>{{ placingName }}</b>
        </span>
        <button class="btn btn-primary btn-sm" @click="$emit('save')">
          💾 Lưu config
        </button>
        <button v-if="hasSelection" class="btn btn-danger btn-sm"
                @click="$emit('delete')">
          🗑 Xóa
        </button>
      </div>
    </div>
  `,
};
