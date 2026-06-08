import { Construction } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';

export default function Placeholder({ title }: { title: string }) {
  const { lang } = useUiStore();
  return (
    <div className="flex flex-col items-center justify-center h-96 text-gray-400 dark:text-gray-600">
      <Construction size={48} className="mb-4 opacity-40" />
      <h2 className="text-lg font-medium text-gray-600 dark:text-gray-400">{title}</h2>
      <p className="text-sm mt-1">
        {lang === 'ar' ? 'قريباً — الخطوات القادمة' : 'Coming soon — next steps'}
      </p>
    </div>
  );
}
