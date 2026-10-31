import { useRef } from 'react';
import { uploadImage } from '../api.ts';
import { useStore } from '../store.ts';
import { Icon, type IconName } from './Icon.tsx';
import { ImportPanel } from './ImportPanel.tsx';
import { IconButton } from './ui.tsx';

const NATIVE_TOOLS: readonly { kind: 'heading' | 'text' | 'image' | 'divider' | 'spacer'; label: string; icon: IconName; tone: string }[] = [
  { kind: 'heading', label: '标题', icon: 'heading', tone: 'sky' },
  { kind: 'text', label: '正文', icon: 'text', tone: 'lilac' },
  { kind: 'image', label: '图片', icon: 'image', tone: 'mint' },
  { kind: 'divider', label: '分割线', icon: 'divider', tone: 'apricot' },
  { kind: 'spacer', label: '间距', icon: 'spacer', tone: 'blush' },
];

/** Insertion lives beside the page: a block lands after the selection, or at the end. */
export function Dock() {
  const addNative = useStore((state) => state.addNative);
  const addImageBlock = useStore((state) => state.addImageBlock);
  const zoom = useStore((state) => state.zoom);
  const setZoom = useStore((state) => state.setZoom);
  const fileRef = useRef<HTMLInputElement>(null);
  const insertionPoint = () => {
    const { selected } = useStore.getState();
    return selected === null ? undefined : selected + 1;
  };

  return (
    <div className="dock" data-glint role="toolbar" aria-label="插入内容">
      {NATIVE_TOOLS.map((tool) => (
        <button type="button" key={tool.kind} data-tone={tool.tone} aria-label={`插入${tool.label}`} onClick={() => addNative(tool.kind, insertionPoint())}>
          <Icon name={tool.icon} size={19} /><span>{tool.label}</span>
        </button>
      ))}
      <span className="dock-rule" />
      <button type="button" data-tone="sky" aria-label="上传图片" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" size={19} /><span>上传</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            const uploaded = await uploadImage(file);
            addImageBlock(uploaded.url);
          } catch (error) {
            useStore.setState({ message: `上传失败：${(error as Error).message}。请重新选择图片重试。` });
          }
        }}
      />
      <ImportPanel />
      <span className="dock-rule" />
      <div className="zoom" role="group" aria-label="画布缩放">
        <IconButton icon="minus" label="缩小画布" tip="缩小 · Ctrl/⌘ −" size={16} disabled={zoom <= 50} onClick={() => setZoom(zoom - 10)} />
        <button type="button" className="zoom-value" data-tip="复位到 100%" aria-label={`当前缩放 ${zoom}%，复位`} onClick={() => setZoom(100)}>{zoom}%</button>
        <IconButton icon="plus" label="放大画布" tip="放大 · Ctrl/⌘ +" size={16} disabled={zoom >= 140} onClick={() => setZoom(zoom + 10)} />
      </div>
    </div>
  );
}
