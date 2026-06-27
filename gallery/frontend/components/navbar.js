import React from 'react';
import { Container, Nav, Navbar, NavItem } from 'react-bootstrap';
import Link from 'next/link'
import { usePing } from '../data/use-ping';

const AuthenticatedNavigation = () => {
  const { features } = usePing();
  return (
    <Nav className="me-auto">
      <Nav.Link as={Link} href="/home">Home</Nav.Link>
      {/* Search + Map features: gated by runtime flags; remove to disable in UI */}
      {features.search && <Nav.Link as={Link} href="/search">Search</Nav.Link>}
      {features.map && <Nav.Link as={Link} href="/map">Map</Nav.Link>}
      <Nav.Link as={Link} href="/admin">Admin</Nav.Link>
      <Nav.Link as={Link} href="/logout">Logout</Nav.Link>
    </Nav>
  );
};

const PublicNavigation = () => (
  <Nav className="me-auto">
    <Nav.Link as={Link} href="/login">Login</Nav.Link>
  </Nav>
);

export default function TopNavbar(redirect = True) {
  const { loggedIn, isLoading } = usePing();

  return (
    <Navbar expand="lg" className="bg-body-tertiary">
      <Navbar.Brand href="/home">Photo Gallery</Navbar.Brand>
      <Navbar.Toggle aria-controls="basic-navbar-nav" />
      <Navbar.Collapse id="basic-navbar-nav">
        {!isLoading && (
          loggedIn ? <AuthenticatedNavigation /> : <PublicNavigation />
        )}
      </Navbar.Collapse>
    </Navbar>
  );
}
