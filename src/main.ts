import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownRenderer, TFile, arrayBufferToBase64 } from 'obsidian';
import domtoimage from 'dom-to-image-more';

// 1. 定义设置项
interface XHSExportSettings {
  exportMode: 'long' | 'paged';
  exportFolderPath: string;
  createDateFolder: boolean;
  paddingX: number;
  pagePaddingTop: number;
  pagePaddingBottom: number;
  fontSizeScale: number;
  themeOverride: 'auto' | 'light' | 'dark';
  enableWatermark: boolean;
  watermarkText: string;
  // 新增：日记头部配置
  enableHeader: boolean;
  authorName: string;
  showVerified: boolean;
  avatarPath: string;
  dateType: 'mtime' | 'ctime' | 'current';
}

const DEFAULT_SETTINGS: XHSExportSettings = {
  exportMode: 'paged', // 默认使用分页切图
  exportFolderPath: '小红书导出', // 默认保存在 "小红书导出" 文件夹
  createDateFolder: true, // 默认开启按日期创建子文件夹
  paddingX: 40,
  pagePaddingTop: 40, // 默认顶部留白 40px
  pagePaddingBottom: 80, // 默认底部留白 80px
  fontSizeScale: 1.2,
  themeOverride: 'light',
  enableWatermark: true,
  watermarkText: '@我的小红书账号',
  enableHeader: false,
  authorName: '作者',
  showVerified: true,
  avatarPath: '',
  dateType: 'mtime'
}

// 辅助函数：获取 YYYYMMDDHHmm 格式的日期
function getFormattedDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}`;
}

// 辅助函数：递归创建多级文件夹
async function ensureFolderExists(app: App, folderPath: string) {
  const parts = folderPath.split('/');
  let currentPath = '';
  for (const part of parts) {
    if (part === '') continue;
    currentPath = currentPath === '' ? part : `${currentPath}/${part}`;
    const folder = app.vault.getAbstractFileByPath(currentPath);
    if (!folder) {
      await app.vault.createFolder(currentPath);
    }
  }
}

// 辅助函数：HEX 颜色转 RGB
function hexToRgb(hex: string) {
  const bigint = parseInt(hex.replace('#', ''), 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

export default class XHSExporterPlugin extends Plugin {
  settings: XHSExportSettings;

  async onload() {
    await this.loadSettings();

    // 添加一个命令：导出当前笔记为小红书长图
    this.addCommand({
      id: 'export-to-xhs',
      name: '导出当前笔记为小红书长图/切图',
      checkCallback: (checking: boolean) => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          if (!checking) {
            this.exportCurrentNote(markdownView);
          }
          return true;
        }
        return false;
      }
    });

    // 添加设置面板
    this.addSettingTab(new XHSExportSettingTab(this.app, this));
  }

  async exportCurrentNote(view: MarkdownView) {
    new Notice('开始生成小红书图片...');
    
    // 1. 获取当前笔记内容
    const file = view.file;
    if (!file) return;
    const content = await this.app.vault.cachedRead(file);

    // 2. 创建一个隐藏的离线渲染容器
    const scale = this.settings.fontSizeScale; // 使用该参数作为全局等比缩放系数
    const layoutWidth = 1080 / scale;

    // 关键修复：为了让第三方主题生效，我们需要模拟 Obsidian 的完整 DOM 结构
    // 很多主题的 CSS 选择器是基于 body 的 class (如 .theme-dark, .theme-minimal)
    const printWrapper = document.createElement('div');
    // 复制 body 的 class，但排除可能导致全屏布局崩溃的系统级 class
    const bodyClasses = Array.from(document.body.classList).filter(c => !['app-container', 'workspace-split', 'workspace-ribbon', 'workspace-tabs'].includes(c));
    printWrapper.classList.add(...bodyClasses);
    
    // 极其激进地覆盖所有可能导致高度塌陷或隐藏的样式
    printWrapper.style.setProperty('position', 'absolute', 'important');
    printWrapper.style.setProperty('left', '-99999px', 'important');
    printWrapper.style.setProperty('top', '0', 'important');
    printWrapper.style.setProperty('width', `${layoutWidth}px`, 'important');
    printWrapper.style.setProperty('height', 'auto', 'important');
    printWrapper.style.setProperty('min-height', 'auto', 'important');
    printWrapper.style.setProperty('max-height', 'none', 'important');
    printWrapper.style.setProperty('overflow', 'visible', 'important');
    printWrapper.style.setProperty('display', 'block', 'important');
    printWrapper.style.setProperty('contain', 'none', 'important');
    printWrapper.style.setProperty('box-shadow', 'none', 'important');
    printWrapper.style.setProperty('margin', '0', 'important');
    printWrapper.style.setProperty('padding', '0', 'important');
    printWrapper.style.setProperty('background', 'transparent', 'important');

    // 强制主题
    if (this.settings.themeOverride === 'light') {
      printWrapper.classList.remove('theme-dark');
      printWrapper.classList.add('theme-light');
    } else if (this.settings.themeOverride === 'dark') {
      printWrapper.classList.remove('theme-light');
      printWrapper.classList.add('theme-dark');
    }

    // 模拟 Obsidian 的层级结构，并解除高度限制
    const leaf = document.createElement('div');
    leaf.className = 'workspace-leaf';
    leaf.style.setProperty('height', 'auto', 'important');
    leaf.style.setProperty('min-height', 'auto', 'important');
    leaf.style.setProperty('max-height', 'none', 'important');
    leaf.style.setProperty('overflow', 'visible', 'important');
    leaf.style.setProperty('display', 'block', 'important');
    leaf.style.setProperty('position', 'relative', 'important');
    leaf.style.setProperty('contain', 'none', 'important');
    leaf.style.setProperty('background', 'transparent', 'important');
    leaf.style.setProperty('border', 'none', 'important');

    const readingView = document.createElement('div');
    readingView.className = 'markdown-reading-view';
    readingView.style.setProperty('height', 'auto', 'important');
    readingView.style.setProperty('min-height', 'auto', 'important');
    readingView.style.setProperty('max-height', 'none', 'important');
    readingView.style.setProperty('overflow', 'visible', 'important');
    readingView.style.setProperty('display', 'block', 'important');
    readingView.style.setProperty('position', 'relative', 'important');
    readingView.style.setProperty('contain', 'none', 'important');
    readingView.style.setProperty('background', 'transparent', 'important');
    readingView.style.setProperty('border', 'none', 'important');
    
    const exportContainer = document.createElement('div');
    exportContainer.className = 'markdown-preview-view markdown-rendered';
    exportContainer.style.setProperty('height', 'auto', 'important');
    exportContainer.style.setProperty('min-height', 'auto', 'important');
    exportContainer.style.setProperty('max-height', 'none', 'important');
    exportContainer.style.setProperty('overflow', 'visible', 'important');
    exportContainer.style.setProperty('display', 'block', 'important');
    exportContainer.style.setProperty('position', 'relative', 'important');
    exportContainer.style.setProperty('contain', 'none', 'important');
    exportContainer.style.setProperty('padding', `${40 / scale}px ${this.settings.paddingX / scale}px`, 'important');
    
    readingView.appendChild(exportContainer);
    leaf.appendChild(readingView);
    printWrapper.appendChild(leaf);
    document.body.appendChild(printWrapper);

    try {
      // 3. 调用 Obsidian 原生渲染引擎！(完美继承主题和 Callout)
      await MarkdownRenderer.renderMarkdown(content, exportContainer, file.path, this);

      // --- 新增：插入日记风格头部 ---
      if (this.settings.enableHeader) {
        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.marginBottom = '32px'; // 增加底部间距，移除边框

        // 头像
        const avatarImg = document.createElement('img');
        avatarImg.style.width = '64px'; // 调大头像
        avatarImg.style.height = '64px';
        avatarImg.style.borderRadius = '50%';
        avatarImg.style.objectFit = 'cover';
        avatarImg.style.marginRight = '16px';
        avatarImg.style.backgroundColor = 'var(--background-secondary)';

        let avatarLoaded = false;
        if (this.settings.avatarPath) {
          try {
            const fs = require('fs');
            const path = require('path');
            const avatarPath = this.settings.avatarPath;
            
            // 优先判断是否为绝对路径
            if (path.isAbsolute(avatarPath) && fs.existsSync(avatarPath)) {
              const buffer = fs.readFileSync(avatarPath);
              const base64 = buffer.toString('base64');
              const ext = path.extname(avatarPath).toLowerCase().replace('.', '');
              const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
              avatarImg.src = `data:${mimeType};base64,${base64}`;
              avatarLoaded = true;
            } else {
              // 尝试作为库内相对路径读取
              const avatarFile = this.app.vault.getAbstractFileByPath(avatarPath);
              if (avatarFile instanceof TFile) {
                const arrayBuffer = await this.app.vault.readBinary(avatarFile);
                const base64 = arrayBufferToBase64(arrayBuffer);
                const ext = avatarFile.extension.toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
                avatarImg.src = `data:${mimeType};base64,${base64}`;
                avatarLoaded = true;
              }
            }
          } catch (e) {
            console.error('加载头像失败:', e);
          }
        }
        
        // 如果没有配置头像或加载失败，使用默认 SVG
        if (!avatarLoaded) {
          avatarImg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjODg4IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDIxdi0yYTRgNCAwIDAgMC00LTRINThhNCA0IDAgMCAwLTQgNHYyIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSI3IiByPSI0Ii8+PC9zdmc+';
          avatarImg.style.padding = '12px';
        }

        // 文字容器
        const textWrapper = document.createElement('div');
        textWrapper.style.display = 'flex';
        textWrapper.style.flexDirection = 'column';

        // 名字行 (包含名字和认证图标)
        const nameRow = document.createElement('div');
        nameRow.style.display = 'flex';
        nameRow.style.alignItems = 'center';

        const nameEl = document.createElement('div');
        nameEl.textContent = this.settings.authorName || '作者';
        nameEl.style.fontWeight = 'bold';
        nameEl.style.fontSize = '22px'; // 调大名字字体
        nameEl.style.color = 'var(--text-normal)';
        nameEl.style.lineHeight = '1.2';
        nameRow.appendChild(nameEl);

        // 认证图标
        if (this.settings.showVerified) {
          const badge = document.createElement('div');
          badge.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" style="margin-left: 6px; color: #1DA1F2; fill: currentColor;"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.918-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.337 2.25c-.416-.165-.866-.25-1.336-.25-2.21 0-3.918 1.79-3.918 4 0 .495.084.965.238 1.4-1.273.65-2.148 2.02-2.148 3.6 0 1.46.74 2.746 1.846 3.45-.065.342-.1.69-.1 1.05 0 2.21 1.71 3.998 3.918 3.998.47 0 .92-.084 1.336-.25C8.49 21.585 9.798 22.5 11.313 22.5c1.516 0 2.824-.915 3.337-2.25.416.165.866.25 1.336.25 2.21 0 3.918-1.79 3.918-4 0-.36-.035-.708-.1-1.05 1.106-.704 1.846-1.99 1.846-3.45zm-11.46 4.16L6.5 12.12l1.41-1.41 3.13 3.13 7.05-7.05 1.41 1.41-8.46 8.46z"/></svg>`;
          badge.style.display = 'flex';
          nameRow.appendChild(badge);
        }

        // 日期
        const dateEl = document.createElement('div');
        let dateVal = Date.now();
        if (this.settings.dateType === 'mtime') dateVal = file.stat.mtime;
        if (this.settings.dateType === 'ctime') dateVal = file.stat.ctime;
        const d = new Date(dateVal);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        dateEl.textContent = `${year}年${month}月${day}日 ${hours}:${minutes}`;
        dateEl.style.fontSize = '15px'; // 调大日期字体
        dateEl.style.color = 'var(--text-muted)';
        dateEl.style.marginTop = '6px';
        dateEl.style.lineHeight = '1.2';

        textWrapper.appendChild(nameRow);
        textWrapper.appendChild(dateEl);
        headerDiv.appendChild(avatarImg);
        headerDiv.appendChild(textWrapper);

        exportContainer.insertBefore(headerDiv, exportContainer.firstChild);
      }

      // 4. 关键修复：将本地图片和双链图片 (![[...]]) 转换为 Base64
      const embeds = exportContainer.querySelectorAll('.internal-embed');
      for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        if (!embed) continue;
        const src = embed.getAttribute('src');
        if (src) {
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(src, file.path);
          if (targetFile instanceof TFile) {
            const arrayBuffer = await this.app.vault.readBinary(targetFile);
            const base64 = arrayBufferToBase64(arrayBuffer);
            const ext = targetFile.extension.toLowerCase();
            const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
            
            const img = document.createElement('img');
            img.src = `data:${mimeType};base64,${base64}`;
            img.style.maxWidth = '100%';
            img.style.display = 'block';
            img.style.margin = '0 auto'; // 居中图片
            img.style.borderRadius = '8px'; // 圆角美化
            
            const width = embed.getAttribute('width');
            if (width) img.style.width = `${width}px`;
            
            embed.innerHTML = ''; // 清空原本的占位符
            embed.appendChild(img);
          }
        }
      }

      // 处理普通的 <img> 标签 (相对路径)
      const imgs = exportContainer.querySelectorAll('img');
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        if (!img) continue;
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('app:')) {
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(src, file.path);
          if (targetFile instanceof TFile) {
            const arrayBuffer = await this.app.vault.readBinary(targetFile);
            const base64 = arrayBufferToBase64(arrayBuffer);
            const ext = targetFile.extension.toLowerCase();
            const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
            img.src = `data:${mimeType};base64,${base64}`;
          }
        }
      }

      // 5. 等待所有图片（主要是网络图片）加载完成
      const allImages = exportContainer.querySelectorAll('img');
      const imagePromises = Array.from(allImages).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      });
      await Promise.all(imagePromises);

      // 额外等待一小段时间，确保异步的 CSS/UI 渲染完成
      await new Promise(resolve => setTimeout(resolve, 800));

      // 5. 调用 dom-to-image-more 截图 (应用等比缩放)
      const isDark = this.settings.themeOverride === 'dark' || (this.settings.themeOverride === 'auto' && document.body.classList.contains('theme-dark'));
      const themeBgColor = isDark ? '#1e1e1e' : '#ffffff';

      // 强制获取实际内容的高度，防止外层 wrapper 被主题 CSS 塌陷
      const targetHeight = Math.max(exportContainer.scrollHeight, 100);

      const dataUrl = await domtoimage.toPng(printWrapper, {
        bgcolor: themeBgColor,
        width: 1080,
        height: targetHeight * scale,
        style: { 
          transform: `scale(${scale})`, 
          transformOrigin: 'top left', 
          width: `${layoutWidth}px`,
          height: `${targetHeight}px`
        }
      });

      // 5. 根据设置决定是保存长图还是分页切图
      let imagesToSave: { name: string, dataUrl: string }[] = [];

      if (this.settings.exportMode === 'long') {
        imagesToSave.push({
          name: `${file.basename}-长图.png`,
          dataUrl: dataUrl
        });
      } else {
        // 分页模式：智能防截断切图
        const img = new Image();
        img.src = dataUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const PAGE_WIDTH = 1080;
        const PAGE_HEIGHT = 1440;
        const totalHeight = img.height;
        
        // 使用一个临时 Canvas 来读取完整的像素数据
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = PAGE_WIDTH;
        tempCanvas.height = totalHeight;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })!;
        tempCtx.drawImage(img, 0, 0);

        const bgColor = themeBgColor;
        const bgRgb = hexToRgb(bgColor);

        let currentY = 0;
        let pageIndex = 1;
        
        const pt = this.settings.pagePaddingTop;
        const pb = this.settings.pagePaddingBottom;
        const maxDrawHeight = PAGE_HEIGHT - pt - pb;

        while (currentY < totalHeight) {
          let drawHeight = Math.min(maxDrawHeight, totalHeight - currentY);
          
          // 智能防截断：如果这不是最后一页，寻找安全的切割点（空白缝隙）
          if (currentY + maxDrawHeight < totalHeight) {
            const idealCutY = currentY + maxDrawHeight;
            // 往上最多寻找 300px 的空白区域
            const minCutY = Math.max(idealCutY - 300, currentY + 100);
            
            let safeCutY = idealCutY;
            for (let y = idealCutY; y >= minCutY; y--) {
              const rowData = tempCtx.getImageData(0, y, PAGE_WIDTH, 1).data;
              let isSafe = true;
              // 检查这一行的每一个像素是否都是背景色
              for (let i = 0; i < rowData.length; i += 4) {
                const r = rowData[i] as number, g = rowData[i+1] as number, b = rowData[i+2] as number;
                // 允许 10 的色差容差（抗锯齿或阴影）
                if (Math.abs(r - bgRgb.r) > 10 || Math.abs(g - bgRgb.g) > 10 || Math.abs(b - bgRgb.b) > 10) {
                  isSafe = false;
                  break;
                }
              }
              if (isSafe) {
                safeCutY = y;
                break; // 找到了最近的空白缝隙
              }
            }
            drawHeight = safeCutY - currentY;
          }

          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = PAGE_WIDTH;
          pageCanvas.height = PAGE_HEIGHT;
          const pageCtx = pageCanvas.getContext('2d')!;

          // 填充背景色
          pageCtx.fillStyle = bgColor;
          pageCtx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

          // 绘制当前页内容
          pageCtx.drawImage(
            tempCanvas,
            0, currentY, PAGE_WIDTH, drawHeight,
            0, pt, PAGE_WIDTH, drawHeight
          );

          // 绘制水印
          if (this.settings.enableWatermark && this.settings.watermarkText) {
            pageCtx.fillStyle = this.settings.themeOverride === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)';
            pageCtx.font = '24px sans-serif';
            pageCtx.textAlign = 'center';
            pageCtx.fillText(this.settings.watermarkText, PAGE_WIDTH / 2, PAGE_HEIGHT - 40);
          }

          imagesToSave.push({
            name: `${file.basename}-P${pageIndex}.png`,
            dataUrl: pageCanvas.toDataURL('image/png')
          });

          currentY += drawHeight;
          pageIndex++;
        }
      }

      // 6. 保存图片到 Obsidian 仓库中
      let folderPath = this.settings.exportFolderPath.trim();
      
      // 如果开启了按日期创建子文件夹
      if (this.settings.createDateFolder) {
        const dateStr = getFormattedDate();
        folderPath = folderPath ? `${folderPath}/${dateStr}` : dateStr;
      }

      // 确保多级文件夹存在
      if (folderPath) {
          await ensureFolderExists(this.app, folderPath);
      }

      // 循环保存所有图片（长图为1张，分页为多张）
      for (const item of imagesToSave) {
        const finalPath = folderPath ? `${folderPath}/${item.name}` : item.name;

        // 将 base64 转换为 ArrayBuffer
        const base64Data = item.dataUrl.split(',')[1] || '';
        const binaryString = window.atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        // 保存文件
        const existingFile = this.app.vault.getAbstractFileByPath(finalPath);
        if (existingFile instanceof TFile) {
            await this.app.vault.modifyBinary(existingFile, arrayBuffer);
        } else if (!existingFile) {
            await this.app.vault.createBinary(finalPath, arrayBuffer);
        }
      }

      new Notice(`导出成功！已保存 ${imagesToSave.length} 张图片到: ${folderPath || '根目录'}`);
      
    } catch (error) {
      console.error(error);
      new Notice('导出失败，请查看控制台 (Ctrl+Shift+I)');
    } finally {
      // 清理 DOM
      document.body.removeChild(printWrapper);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// 设置面板 UI
class XHSExportSettingTab extends PluginSettingTab {
  plugin: XHSExporterPlugin;

  constructor(app: App, plugin: XHSExporterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    containerEl.createEl('h2', {text: '小红书长图导出设置'});

    new Setting(containerEl)
      .setName('导出模式')
      .setDesc('选择导出为单张长图，还是自动切分为多张小红书比例 (1080x1440) 的分页图片')
      .addDropdown(dropdown => dropdown
        .addOption('paged', '分页切图 (推荐)')
        .addOption('long', '单张长图')
        .setValue(this.plugin.settings.exportMode)
        .onChange(async (value: 'long' | 'paged') => {
          this.plugin.settings.exportMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('导出文件夹')
      .setDesc('图片保存的目录（相对于仓库根目录，例如：Attachments/XHS）。留空则保存在根目录。')
      .addText(text => text
        .setPlaceholder('例如: 小红书导出')
        .setValue(this.plugin.settings.exportFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.exportFolderPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('按日期创建子文件夹')
      .setDesc('开启后，会在导出目录下自动创建类似 202603211000 的时间文件夹')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.createDateFolder)
        .onChange(async (value) => {
          this.plugin.settings.createDateFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('水印文字')
      .setDesc('显示在每张切图底部的水印')
      .addText(text => text
        .setPlaceholder('@你的账号')
        .setValue(this.plugin.settings.watermarkText)
        .onChange(async (value) => {
          this.plugin.settings.watermarkText = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('启用水印')
      .setDesc('是否在长图底部显示水印')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableWatermark)
        .onChange(async (value) => {
          this.plugin.settings.enableWatermark = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('左右边距 (Padding)')
      .setDesc('长图内容的左右留白大小 (像素)')
      .addSlider(slider => slider
        .setLimits(0, 100, 5)
        .setValue(this.plugin.settings.paddingX)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.paddingX = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('分页顶部留白')
      .setDesc('每张切图顶部的留白高度(像素)。让切图顶部不至于太拥挤。')
      .addSlider(slider => slider
        .setLimits(0, 300, 10)
        .setValue(this.plugin.settings.pagePaddingTop)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.pagePaddingTop = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('分页底部留白 (防截断/水印)')
      .setDesc('每张切图底部的留白高度(像素)。调大此值可防止正文与底部水印重叠，并让切图边缘更美观。')
      .addSlider(slider => slider
        .setLimits(0, 300, 10)
        .setValue(this.plugin.settings.pagePaddingBottom)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.pagePaddingBottom = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('整体缩放比例 (等比放大)')
      .setDesc('调整导出长图的整体内容大小 (包含字体和图片)。值越大，内容显得越大。默认 1.2')
      .addSlider(slider => slider
        .setLimits(0.5, 3.0, 0.1)
        .setValue(this.plugin.settings.fontSizeScale)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.fontSizeScale = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('强制主题')
      .setDesc('导出时长图使用的主题模式')
      .addDropdown(dropdown => dropdown
        .addOption('auto', '跟随系统/当前主题')
        .addOption('light', '强制浅色模式')
        .addOption('dark', '强制深色模式')
        .setValue(this.plugin.settings.themeOverride)
        .onChange(async (value: 'auto' | 'light' | 'dark') => {
          this.plugin.settings.themeOverride = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', {text: '日记头部设置 (显示在第一页顶部)'});

    new Setting(containerEl)
      .setName('启用日记头部')
      .setDesc('在长图最上方显示头像、名字和日期')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableHeader)
        .onChange(async (value) => {
          this.plugin.settings.enableHeader = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('作者名字')
      .setDesc('显示在头像旁边的名字')
      .addText(text => text
        .setPlaceholder('例如: FOX AI')
        .setValue(this.plugin.settings.authorName)
        .onChange(async (value) => {
          this.plugin.settings.authorName = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('显示官方认证图标')
      .setDesc('在名字旁边显示蓝色的官方认证标识')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showVerified)
        .onChange(async (value) => {
          this.plugin.settings.showVerified = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('头像路径 (支持绝对路径)')
      .setDesc('支持电脑上的绝对路径 (如 D:\\images\\avatar.png) 或库内相对路径。留空则使用默认图标。')
      .addText(text => text
        .setPlaceholder('C:\\Users\\xxx\\avatar.png')
        .setValue(this.plugin.settings.avatarPath)
        .onChange(async (value) => {
          this.plugin.settings.avatarPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('日期类型')
      .setDesc('头部显示的日期时间来源')
      .addDropdown(dropdown => dropdown
        .addOption('mtime', '笔记最后修改时间')
        .addOption('ctime', '笔记创建时间')
        .addOption('current', '当前导出时间')
        .setValue(this.plugin.settings.dateType)
        .onChange(async (value: 'mtime' | 'ctime' | 'current') => {
          this.plugin.settings.dateType = value;
          await this.plugin.saveSettings();
        }));
  }
}
