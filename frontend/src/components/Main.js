import React from 'react';
import { Switch, Route, Redirect } from 'react-router-dom';
import Login from './Login';
import Home from './Home';

const auth = {
  token: false,
  authenticate(token) {
    this.token = token;
  },
  clear() {
    this.token = false;
  }
}

const PrivateRoute = ({ component: Component, ...rest }) => (
  <Route {...rest} render={props => (
    auth.token ? (
      <Component {...props}/>
    ) : (
      <Redirect to={{
        pathname: '/login',
        state: { from: props.location }
      }}/>
    )
  )}/>
);

const Main = () => (
  <main>
    <Switch>
      <PrivateRoute exact path='/' component={Home}/>
      <Route path='/login' component={Login} loginCallback={auth.authenticate} />
    </Switch>
  </main>
);

export default Main;

