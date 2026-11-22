import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Button } from './Button';
import { ConfirmationDialog } from './ConfirmationDialog';
import { DataTable, Pagination } from './DataTable';
import { PriceDisplay, RatingDisplay, Avatar } from './Display';
import { Dropdown } from './Dropdown';
import { MultiSelect } from './Select';
import { Tabs } from './Tabs';
import { ToastProvider, useToast } from './Toast';

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ConfirmationDialog', () => {
  it('focuses Cancel first and confirms on demand', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmationDialog
        open
        title="Delete?"
        description="This cannot be undone."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('Dropdown', () => {
  it('supports arrow-key navigation and returns focus on Escape', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Dropdown
        trigger={(props) => <button {...props}>Options</button>}
        items={[
          { id: 'a', label: 'First', onSelect: vi.fn() },
          { id: 'b', label: 'Second', onSelect },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Options' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    await vi.waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: 'First' })).toHaveFocus(),
    );
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Second' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Second' }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('Tabs', () => {
  it('moves selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="Sections"
        items={[
          { id: 'one', label: 'One', content: <p>Panel one</p> },
          { id: 'two', label: 'Two', content: <p>Panel two</p> },
        ]}
      />,
    );
    const first = screen.getByRole('tab', { name: 'One' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel two');
  });
});

describe('MultiSelect', () => {
  function Harness() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <MultiSelect
        label="Roles"
        value={value}
        onChange={setValue}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta', disabled: true },
          { value: 'c', label: 'Gamma' },
        ]}
      />
    );
  }

  it('toggles options from the keyboard and skips disabled ones', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Roles/ }));
    const listbox = await screen.findByRole('listbox', { name: 'Roles' });
    await vi.waitFor(() => expect(listbox).toHaveFocus());
    await user.keyboard(' ');
    expect(within(listbox).getByRole('option', { name: /Alpha/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowDown} ');
    expect(within(listbox).getByRole('option', { name: /Gamma/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(listbox).getByRole('option', { name: /Beta/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});

describe('DataTable & Pagination', () => {
  it('renders rows, empty and error states', async () => {
    const columns = [
      { id: 'name', header: 'Name', cell: (r: { id: string; name: string }) => r.name },
    ];
    const { rerender } = render(
      <DataTable
        caption="People"
        columns={columns}
        rows={[{ id: '1', name: 'Asha' }]}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Asha' })).toBeInTheDocument();

    rerender(
      <DataTable
        caption="People"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        empty={<p>Nobody here</p>}
      />,
    );
    expect(screen.getByText('Nobody here')).toBeInTheDocument();

    const onRetry = vi.fn();
    rerender(
      <DataTable
        caption="People"
        columns={columns}
        rows={undefined}
        getRowId={(r) => r.id}
        error={{ message: 'Failed to load', requestId: 'req-9' }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load');
    expect(screen.getByText(/req-9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('marks the current page', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

describe('display components', () => {
  it('formats integer minor units', () => {
    render(
      <PriceDisplay
        amountMinor={1_249_900}
        currency="INR"
        period="/ night"
        originalAmountMinor={1_499_900}
      />,
    );
    expect(screen.getByText(/₹12,499\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Original price/)).toBeInTheDocument();
  });

  it('describes ratings accessibly', () => {
    render(<RatingDisplay value={4.46} count={128} />);
    expect(
      screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 128 reviews' }),
    ).toBeInTheDocument();
  });

  it('falls back to initials without an image', () => {
    render(<Avatar name="Asha Rao" />);
    expect(screen.getByRole('img', { name: 'Asha Rao' })).toHaveTextContent('AR');
  });

  it('announces toasts politely and errors assertively', async () => {
    function Trigger() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast({ title: 'Saved', variant: 'success' })}>ok</button>
          <button onClick={() => toast({ title: 'Failed', variant: 'error' })}>bad</button>
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'ok' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    await user.click(screen.getByRole('button', { name: 'bad' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed');
  });
});
