import TopNavbar from './navbar'
//import Footer from './footer'
 
export default function Layout({ children }) {
  //    <Footer />
  return (
    <>
      <TopNavbar />
      <main>{children}</main>
    </>
  )
}