import React from 'react';
import { RARITY_WEIGHTS } from '../../shared/gameRules.js';

// Item card modal: art, specs by category, description — and for lore items,
// the letter/story text itself.
export default function ItemDetail({ item, onClose }) {
  if (!item) return null;
  const specs = [];
  if (item.category === 'weapon') {
    if (item.damage) specs.push(['Damage', item.damage]);
    if (item.range != null) specs.push(['Range', `${item.range} m`]);
  }
  const rarity = (item.tags || []).find((t) => t in RARITY_WEIGHTS);
  if (rarity) specs.push(['Rarity', rarity]);
  if (item.category === 'armor' && item.armor != null) specs.push(['Armor', `+${item.armor}`]);
  specs.push(['Weight', `${item.weight} / ${item.measure === 'unit' ? 'unit' : item.measure}`]);
  specs.push(['Value', `${item.value} gp`]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog item-detail" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>{item.name}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <p className="cat-badge">{item.category === 'campaign' ? 'campaign (DM-given)' : item.category}</p>
        {item.image && <img className="item-art" src={item.image} alt="" />}
        <dl className="spec-list">
          {specs.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {item.description && <p>{item.description}</p>}
        {item.lore_text && <div className="lore-text">{item.lore_text}</div>}
      </div>
    </div>
  );
}
