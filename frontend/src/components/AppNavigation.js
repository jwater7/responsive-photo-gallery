import React from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from 'react-bootstrap';
import PublicNavigation from './PublicNavigation';
import AuthenticatedNavigation from './AuthenticatedNavigation';

const renderNavigation = authenticated => (
  authenticated ? <AuthenticatedNavigation /> : <PublicNavigation />
);

class AppNavigation extends React.Component {

  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    document.title = this.props.pagetitle;
  }

  render() {
    return (
      <Navbar>
        <Navbar.Header>
          <Navbar.Brand>
            <Link to="/">{this.props.pagetitle}</Link>
          </Navbar.Brand>
          <Navbar.Toggle />
        </Navbar.Header>
        <Navbar.Collapse>
          { renderNavigation(this.props.authenticated) }
        </Navbar.Collapse>
      </Navbar>
    );
  }
}

export default AppNavigation;

