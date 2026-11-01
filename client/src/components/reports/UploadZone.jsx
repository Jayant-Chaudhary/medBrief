import { useState, useRef } from 'react';
import { UploadCloud } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export default function UploadZone({ onUpload, onBusy, disabled = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files[0]);
    }
    // Otherwise picking the same file again after a cancelled upload does nothing.
    e.target.value = '';
  };

  const handleFiles = (file) => {
    // The button is disabled mid-upload, but a dropped file still lands here.
    if (disabled) {
      onBusy?.();
      return;
    }
    onUpload(file);
  };

  return (
    <Card 
      className={`border-2 border-dashed transition-all duration-200 ${
        isDragging ? 'border-primary bg-primary-light/50' : 'border-ink-soft/30 bg-canvas hover:bg-raised hover:border-primary/50'
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-raised rounded-full flex items-center justify-center mb-4 shadow-sm text-primary">
          <UploadCloud size={32} />
        </div>
        <h3 className="font-bold text-lg text-ink mb-2">Upload a Lab Report</h3>
        <p className="text-sm text-ink-soft max-w-sm mb-6">
          Drag and drop your printed lab report here, or click to take a photo or browse your files.
        </p>
        
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleChange} 
          className="hidden" 
          accept="image/png,image/jpeg,application/pdf"
        />
        
        <Button onClick={() => fileInputRef.current?.click()} className="px-8" disabled={disabled}>
          {disabled ? 'Uploading…' : 'Select File'}
        </Button>
      </div>
    </Card>
  );
}
