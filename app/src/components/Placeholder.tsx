import { Screen } from './Screen';
import './Placeholder.css';

interface Props {
  eyebrow: string;
  title: string;
  lead: string;
  /** Что этот экран будет делать. Список честный: это план, а не обещание готового. */
  planned: string[];
  spec: string;
}

/** Экран-заготовка. Держит структуру и ссылку на спецификацию, чтобы не расходиться с документами. */
export function Placeholder({ eyebrow, title, lead, planned, spec }: Props) {
  return (
    <Screen eyebrow={eyebrow} title={title} lead={lead}>
      <ul className="plan">
        {planned.map((p) => <li key={p} className="plan__item">{p}</li>)}
      </ul>
      <p className="plan__spec">Спецификация: {spec}</p>
    </Screen>
  );
}
