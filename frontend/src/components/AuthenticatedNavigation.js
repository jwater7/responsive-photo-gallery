import React from 'react';
import { NavLink } from 'react-router-dom';
import { Nav } from 'react-bootstrap';

const AuthenticatedNavigation = () => (
  <Nav pullRight>
    <li>
      <NavLink to="/logout" activeClassName="active">Logout</NavLink>
    </li>
  </Nav>
);

export default AuthenticatedNavigation;

