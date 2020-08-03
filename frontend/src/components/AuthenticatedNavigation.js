import React from 'react';
import { Nav, NavItem } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

const AuthenticatedNavigation = () => (
  <Nav pullRight>
    <LinkContainer to="/logout">
      <NavItem>Logout</NavItem>
    </LinkContainer>
  </Nav>
);

export default AuthenticatedNavigation;
