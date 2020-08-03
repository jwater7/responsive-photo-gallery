import React from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from 'react-bootstrap';
import PublicNavigation from './PublicNavigation';
import AuthenticatedNavigation from './AuthenticatedNavigation';

const renderNavigation = (authtoken) =>
  authtoken ? <AuthenticatedNavigation /> : <PublicNavigation />;

class AppNavigation extends React.Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  async componentDidMount() {
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
          {renderNavigation(this.props.authtoken)}
        </Navbar.Collapse>
      </Navbar>
    );
  }
}

export default AppNavigation;
