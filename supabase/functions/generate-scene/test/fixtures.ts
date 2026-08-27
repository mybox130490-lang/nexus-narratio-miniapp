import type { SceneCandidate, StoryCandidate } from '../lib/contract.ts';

/** Заполнитель ровно из N слов — чтобы не писать по 500 слов вручную. */
export function filler(words: number): string {
  return Array.from({ length: words }, (_, i) => `слово${i + 1}`).join(' ');
}

function ordinaryScene(index: number, of: number): SceneCandidate {
  const isLast = index === of;
  return {
    scene_index: index,
    text: filler(500),
    anchor_required: isLast,
    choices: isLast
      ? []
      : [
          {
            choice_id: 'ch_a',
            label: 'Пойти вперёд',
            axes: [{ axis: 'approach', pole: 'A', weight: 1 }],
            cost: 'оставить сомнение позади',
          },
          {
            choice_id: 'ch_b',
            label: 'Остаться и подождать',
            axes: [{ axis: 'control', pole: 'B', weight: 0.5 }],
            cost: 'упустить момент',
          },
        ],
    field_task: null,
  };
}

/** Валидная история из 5 сцен — минимальный проходящий образец для мутации в тестах. */
export function validStory(sceneCount = 5): StoryCandidate {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ordinaryScene(i + 1, sceneCount));
  return {
    seed: {
      motifs: ['бабочки', 'дорога'],
      tone: 'светлый, дневной',
      central_conflict: 'довериться лёгкости или проверить её на прочность',
      archetypes: ['trickster'],
      target_axes: ['approach', 'novelty'],
    },
    scenes,
  };
}
