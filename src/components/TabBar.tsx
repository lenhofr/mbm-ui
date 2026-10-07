import React from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '../icons/Icons'
import './TabBar.css'

export default function TabBar({ onAdd }: { onAdd: () => void }) {
  return (
    <nav className="tabbar" aria-label="Main">
      <NavLink to="/" end className={({ isActive }) => 'tab-item' + (isActive ? ' on' : '')}>
        <Icon name="book" size={24} />
        <span>Recipes</span>
      </NavLink>
      <button type="button" className="tab-add" onClick={onAdd} aria-label="Add a recipe">
        <Icon name="plus" size={26} weight="bold" />
      </button>
      <NavLink to="/favorites" className={({ isActive }) => 'tab-item' + (isActive ? ' on' : '')}>
        {({ isActive }) => (
          <>
            <Icon name="heart" size={24} filled={isActive} />
            <span>Favorites</span>
          </>
        )}
      </NavLink>
    </nav>
  )
}
