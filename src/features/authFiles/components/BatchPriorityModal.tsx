import { useCallback, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface BatchPriorityModalProps {
  open: boolean;
  count: number;
  loading: boolean;
  onConfirm: (priority: number) => void;
  onClose: () => void;
}

export function BatchPriorityModal({
  open,
  count,
  loading,
  onConfirm,
  onClose,
}: BatchPriorityModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  const parsed = value.trim() ? parseInt(value, 10) : NaN;
  const isValid = !isNaN(parsed) && Number.isFinite(parsed);

  const handleConfirm = useCallback(() => {
    if (!isValid) return;
    onConfirm(parsed);
  }, [isValid, parsed, onConfirm]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    },
    [handleConfirm]
  );

  const handleClose = useCallback(() => {
    if (loading) return;
    setValue('');
    onClose();
  }, [loading, onClose]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('auth_files.batch_priority_title')}
      closeDisabled={loading}
      width={400}
    >
      <p style={{ margin: '0.5rem 0 1rem' }}>
        {t('auth_files.batch_priority_message', { count })}
      </p>
      <Input
        type="number"
        value={value}
        placeholder={t('auth_files.batch_priority_placeholder')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
        autoFocus
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleConfirm} loading={loading} disabled={!isValid}>
          {t('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
