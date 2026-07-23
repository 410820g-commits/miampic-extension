# Miampic

Miampic 是一个浏览器扩展，用来从截图、上传图片或网页右键图片中生成 AI 生图提示词。

## 当前版本

V1.0.1

## 目录说明

```text
extension/              插件源码
public/                 Coze / Vite 项目的静态资源目录
docs/                   GitHub Pages 推荐发布目录
  index.html            插件介绍页
  miampic-extension.zip 插件下载包
```

## 本地安装插件

1. 下载或克隆本仓库。
2. 打开 Chrome / Edge 扩展管理页。
3. 开启开发者模式。
4. 点击“加载已解压的扩展程序”。
5. 选择 `extension/` 文件夹。

## 发布介绍页

推荐使用 GitHub Pages：

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

发布后介绍页会托管在：

```text
https://prunegeng.github.io/miampic-extension/
```

## 更新插件下载包

每次修改插件后，需要同步更新：

- `extension/`
- `docs/miampic-extension.zip`
- `public/miampic-extension.zip`
