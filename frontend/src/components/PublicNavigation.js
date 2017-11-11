import React from 'react';
import { Nav, NavItem } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

const PublicNavigation = () => (
  <Nav pullRight>
    <LinkContainer to="/login">
      <NavItem>Login</NavItem>
    </LinkContainer>
  </Nav>
);

export default PublicNavigation;

