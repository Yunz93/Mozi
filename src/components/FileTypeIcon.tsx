import React from 'react';
import { Icons } from './Icon';
import type { FileIconKind } from '../utils/fileIconKind';
import { getFileIconKind } from '../utils/fileIconKind';

interface FileTypeIconProps {
  fileName: string;
  className?: string;
  size?: number;
}

const BY_KIND: Record<FileIconKind, React.FC<{ size?: number; className?: string }>> = {
  markdown: Icons.FileMarkdown,
  image: Icons.FileImage,
  pdf: Icons.FilePdf,
  text: Icons.FileText,
  spreadsheet: Icons.FileSpreadsheet,
  presentation: Icons.FilePresentation,
  archive: Icons.FileArchive,
  audio: Icons.FileAudio,
  video: Icons.FileVideo,
  code: Icons.FileCode,
  excalidraw: Icons.FileExcalidraw,
  file: Icons.File,
};

export const FileTypeIcon: React.FC<FileTypeIconProps> = ({ fileName, className, size = 16 }) => {
  const Cmp = BY_KIND[getFileIconKind(fileName)];
  return <Cmp size={size} className={className} />;
};
